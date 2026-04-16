import debugCore from 'debug';

import {constants, errorUtils} from '@verdaccio/core';
import type {Callback, Config, Logger, PackageAccess, RemoteUser} from '@verdaccio/types';

import type {LdapConfig} from '../types';
import {createLdapClient, bindClient, searchLdap, unbindClient} from './ldapClient';
import migrateLegacyConfig from './migrateLegacyConfig';
import setConfigValue from './setConfigValue';

const debug = debugCore('verdaccio:plugin:ldap');

/**
 * Escape a DN (or any string) for safe interpolation into an LDAP search
 * filter per RFC 4515 §3.
 */
function escapeFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (ch) => {
    switch (ch) {
      case '\\':
        return '\\5c';
      case '*':
        return '\\2a';
      case '(':
        return '\\28';
      case ')':
        return '\\29';
      case '\0':
        return '\\00';
      /* c8 ignore next 2 */
      default:
        return ch;
    }
  });
}

/**
 * Extract the value of the first RDN from a DN. For `CN=Fiehe\, Christoph,OU=Foo,DC=bar`
 * this returns `Fiehe, Christoph`. Falls back to the input when it does not
 * look like a DN (no `=` before the first unescaped `,`).
 */
function extractFirstRDNValue(dn: string): string {
  const match = dn.match(/^[^=,]+=((?:\\.|[^,\\])+)/);
  if (!match) {
    return dn;
  }
  // Unescape DN value: \, → , \\ → \ \# → #, etc.
  return match[1].replace(/\\(.)/g, '$1');
}

export default class LdapAuthPlugin {
  public logger: Logger;
  public config: LdapConfig;

  public constructor(config: Config, options: {logger: Logger; config: Config}) {
    this.logger = options.logger;
    if (!config) {
      throw new Error(
        'ldap auth missing config. Add `auth.@verdaccio/auth-ldap` to your config file'
      );
    }

    const pluginConfig = config.auth?.['@verdaccio/auth-ldap'] ?? config.auth?.['ldap'] ?? {};
    const merged = Object.assign({}, config, pluginConfig);
    const migrated = migrateLegacyConfig(merged, options.logger);
    this.config = migrated as LdapConfig;

    this.config.url = setConfigValue(this.config.url);
    this.config.baseDN = setConfigValue(this.config.baseDN);
    if (this.config.bindDN) {
      this.config.bindDN = setConfigValue(this.config.bindDN);
    }
    if (this.config.bindCredentials) {
      this.config.bindCredentials = setConfigValue(this.config.bindCredentials);
    }
    if (this.config.groupSearchBase) {
      this.config.groupSearchBase = setConfigValue(this.config.groupSearchBase);
    }

    if (!this.config.url) {
      throw new Error('ldap auth requires a url');
    }

    if (!this.config.baseDN) {
      throw new Error('ldap auth requires a baseDN');
    }

    this.config.searchFilter = this.config.searchFilter || '(uid={{username}})';
    this.config.usernameAttribute = this.config.usernameAttribute || 'uid';
    this.config.groupAttribute = this.config.groupAttribute || 'cn';
    this.config.groupSearchFilter = this.config.groupSearchFilter || '(memberUid={{username}})';

    debug(
      'initialized url=%o baseDN=%o bindDN=%o searchFilter=%o',
      this.config.url,
      this.config.baseDN,
      this.config.bindDN || 'anonymous',
      this.config.searchFilter
    );
    this.logger.trace(
      {url: this.config.url, baseDN: this.config.baseDN},
      'ldap: plugin initialized url=@{url} baseDN=@{baseDN}'
    );
  }

  /**
   * Authenticate a user against LDAP/Active Directory.
   *
   * 1. Bind with service account (if configured) to search for the user DN
   * 2. Search for the user using the configured filter
   * 3. Bind with the user's DN and password to verify credentials
   * 4. Search for the user's groups
   * 5. Return the group list on success
   */
  public authenticate(user: string, password: string, cb: Callback): void {
    debug('authenticate user=%o', user);
    this.logger.trace({user}, 'ldap: [authenticate] user=@{user}');

    void (async (): Promise<void> => {
      const client = createLdapClient(this.config);
      try {
        // Step 1: Bind with service account for searching
        if (this.config.bindDN && this.config.bindCredentials) {
          await bindClient(client, this.config.bindDN, this.config.bindCredentials);
        }

        // Step 2: Search for the user DN
        const searchFilter = this.config.searchFilter!.replace(/\{\{username\}\}/g, user);
        const userAttributes = [this.config.usernameAttribute!, 'dn'];
        if (this.config.userGroupsAttribute) {
          userAttributes.push(this.config.userGroupsAttribute);
        }
        const userEntries = await searchLdap(
          client,
          this.config.baseDN,
          searchFilter,
          userAttributes
        );

        if (userEntries.length === 0) {
          debug('authenticate user=%o not found in LDAP', user);
          this.logger.warn({user}, 'ldap: [authenticate] user=@{user} not found');
          cb(errorUtils.getUnauthorized('invalid credentials'));
          return;
        }

        const userEntry = userEntries[0];
        const userDN = userEntry.dn;
        debug('authenticate user=%o found dn=%o', user, userDN);

        // Step 3: Bind with user credentials to verify password
        const userClient = createLdapClient(this.config);
        try {
          await bindClient(userClient, userDN, password);
        } catch (bindErr: any) {
          debug('authenticate user=%o bind failed: %o', user, bindErr.message);
          this.logger.warn(
            {user, error: bindErr.message},
            'ldap: [authenticate] user=@{user} bind failed: @{error}'
          );
          cb(errorUtils.getUnauthorized('invalid credentials'));
          return;
        } finally {
          await unbindClient(userClient);
        }

        // Step 4: Resolve user groups
        let groups: string[] = [];
        if (this.config.userGroupsAttribute) {
          // Prefer reading group membership directly from the user entry
          // (e.g. AD's `memberOf`). No extra LDAP round-trip.
          const raw = userEntry[this.config.userGroupsAttribute];
          const values: string[] = Array.isArray(raw)
            ? (raw as unknown[]).map(String)
            : raw != null
              ? [String(raw)]
              : [];
          groups = values
            .map((value) => (value.includes('=') ? extractFirstRDNValue(value) : value))
            .filter(Boolean);
          debug(
            'authenticate user=%o groups resolved from user attribute %o: %o',
            user,
            this.config.userGroupsAttribute,
            groups
          );
        } else if (this.config.groupSearchBase) {
          const groupFilter = this.config
            .groupSearchFilter!.replace(/\{\{username\}\}/g, user)
            .replace(/\{\{userDN\}\}/g, escapeFilterValue(userDN));
          const groupEntries = await searchLdap(client, this.config.groupSearchBase, groupFilter, [
            this.config.groupAttribute!,
          ]);

          groups = groupEntries
            .map((entry) => {
              const val = entry[this.config.groupAttribute!];
              if (Array.isArray(val)) return val[0] as string;
              return val as string;
            })
            .filter(Boolean);
        }

        // Apply group mapping
        if (this.config.groupMapping) {
          groups = groups.map((g) => this.config.groupMapping![g] || g);
        }

        debug('authenticate user=%o success, groups=%o', user, groups);
        this.logger.trace(
          {user, groups},
          'ldap: [authenticate] user=@{user} authenticated with groups=@{groups}'
        );
        cb(null, groups);
      } catch (err: any) {
        debug('authenticate user=%o error: %o', user, err.message);
        this.logger.error(
          {user, error: err.message},
          'ldap: [authenticate] user=@{user} error: @{error}'
        );
        cb(errorUtils.getUnauthorized(err.message));
      } finally {
        await unbindClient(client);
      }
    })();
  }

  /**
   * User creation is always disabled — users are managed in LDAP.
   * Delegates to authenticate so existing LDAP users can obtain a token.
   */
  public adduser(user: string, password: string, cb: Callback): void {
    debug('adduser user=%o (will attempt LDAP auth)', user);
    this.authenticate(user, password, (err, groups) => {
      if (err) {
        debug('adduser user=%o LDAP auth failed, rejecting registration', user);
        cb(errorUtils.getConflict('user registration is disabled, users are managed in LDAP'));
        return;
      }
      debug('adduser user=%o LDAP auth succeeded', user);
      cb(null, groups);
    });
  }

  public allow_access(
    user: RemoteUser,
    pkg: PackageAccess,
    cb: (error: any, access?: boolean) => void
  ): void {
    const allowed = this._checkAccess(user, pkg.access);
    debug('allow_access user=%o pkg=%o allowed=%o', user.name, (pkg as any).name, allowed);
    if (allowed) {
      cb(null, true);
    } else {
      cb(errorUtils.getForbidden('access denied'));
    }
  }

  public allow_publish(
    user: RemoteUser,
    pkg: PackageAccess,
    cb: (error: any, access?: boolean) => void
  ): void {
    const allowed = this._checkAccess(user, pkg.publish);
    debug('allow_publish user=%o pkg=%o allowed=%o', user.name, (pkg as any).name, allowed);
    if (allowed) {
      cb(null, true);
    } else {
      cb(errorUtils.getForbidden('publish not allowed'));
    }
  }

  public allow_unpublish(
    user: RemoteUser,
    pkg: PackageAccess,
    cb: (error: any, access?: boolean) => void
  ): void {
    const groups = Array.isArray(pkg.unpublish) ? pkg.unpublish : pkg.publish;
    const allowed = this._checkAccess(user, groups);
    debug('allow_unpublish user=%o pkg=%o allowed=%o', user.name, (pkg as any).name, allowed);
    if (allowed) {
      cb(null, true);
    } else {
      cb(errorUtils.getForbidden('unpublish not allowed'));
    }
  }

  private _checkAccess(user: RemoteUser, requiredGroups?: string[]): boolean {
    if (!requiredGroups || requiredGroups.length === 0) {
      return false;
    }

    const {ROLES} = constants;

    if (requiredGroups.includes(ROLES.$ALL)) {
      return true;
    }

    if (requiredGroups.includes(ROLES.$ANONYMOUS) && !user.name) {
      return true;
    }

    if (requiredGroups.includes(ROLES.$AUTH) && user.name) {
      return true;
    }

    const userGroups = user.groups || [];
    return requiredGroups.some((g) => userGroups.includes(g));
  }
}
