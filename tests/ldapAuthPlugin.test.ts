import {describe, test, expect, vi, beforeEach} from 'vitest';
import type {Config, Logger, RemoteUser, PackageAccess} from '@verdaccio/types';

import LdapAuthPlugin from '../src/ldapAuthPlugin';

const logger: Logger = {
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  child: vi.fn(),
  http: vi.fn(),
  trace: vi.fn(),
} as any;

// Mock ldapClient module
let mockBindClient: ReturnType<typeof vi.fn>;
let mockSearchLdap: ReturnType<typeof vi.fn>;
let mockUnbindClient: ReturnType<typeof vi.fn>;

vi.mock('../src/ldapClient', () => ({
  createLdapClient: vi.fn(() => ({})),
  bindClient: (...args: any[]) => mockBindClient(...args),
  searchLdap: (...args: any[]) => mockSearchLdap(...args),
  unbindClient: (...args: any[]) => mockUnbindClient(...args),
}));

function makeConfig() {
  return {
    auth: {
      '@verdaccio/auth-ldap': {
        url: 'ldap://localhost:389',
        baseDN: 'ou=users,dc=example,dc=org',
        bindDN: 'cn=admin,dc=example,dc=org',
        bindCredentials: 'admin',
        groupSearchBase: 'ou=groups,dc=example,dc=org',
      },
    },
  } as unknown as Config;
}

function createPlugin(): LdapAuthPlugin {
  return new LdapAuthPlugin(makeConfig(), {logger, config: makeConfig()});
}

function cbToPromise<T = any>(fn: (cb: (...args: any[]) => void) => void): Promise<T[]> {
  return new Promise((resolve) => {
    fn((...args: any[]) => resolve(args));
  });
}

function makeUser(name: string | void, groups: string[] = []): RemoteUser {
  return {name, groups, real_groups: groups};
}

function makePkg(
  access?: string[],
  publish?: string[],
  unpublish?: string[]
): PackageAccess & {name: string} {
  return {name: 'test-pkg', access, publish, unpublish} as any;
}

describe('LdapAuthPlugin', () => {
  beforeEach(() => {
    mockBindClient = vi.fn().mockResolvedValue(undefined);
    mockSearchLdap = vi.fn().mockResolvedValue([]);
    mockUnbindClient = vi.fn().mockResolvedValue(undefined);
  });

  describe('constructor', () => {
    test('throws when config is falsy', () => {
      expect(() => new LdapAuthPlugin(null as any, {logger, config: {} as any})).toThrow(
        'ldap auth missing config'
      );
    });

    test('throws when url is missing', () => {
      const config = {auth: {'@verdaccio/auth-ldap': {baseDN: 'dc=test'}}} as unknown as Config;
      expect(() => new LdapAuthPlugin(config, {logger, config})).toThrow('requires a url');
    });

    test('throws when baseDN is missing', () => {
      const config = {
        auth: {'@verdaccio/auth-ldap': {url: 'ldap://localhost'}},
      } as unknown as Config;
      expect(() => new LdapAuthPlugin(config, {logger, config})).toThrow('requires a baseDN');
    });

    test('creates instance with valid config', () => {
      const plugin = createPlugin();
      expect(plugin).toBeDefined();
      expect(plugin.config.url).toBe('ldap://localhost:389');
      expect(plugin.config.baseDN).toBe('ou=users,dc=example,dc=org');
    });

    test('sets default searchFilter', () => {
      const plugin = createPlugin();
      expect(plugin.config.searchFilter).toBe('(uid={{username}})');
    });

    test('accepts legacy verdaccio-ldap config format', () => {
      const config = {
        auth: {
          ldap: {
            type: 'ldap',
            groupNameAttribute: 'cn',
            client_options: {
              url: 'ldap://ldap.example.com',
              adminDn: 'cn=admin,dc=example,dc=com',
              adminPassword: 'admin',
              searchBase: 'ou=People,dc=example,dc=com',
              searchFilter: '(uid={{username}})',
              groupSearchBase: 'ou=groups,dc=example,dc=com',
              groupSearchFilter: '(member={{dn}})',
            },
          },
        },
      } as unknown as Config;
      const plugin = new LdapAuthPlugin(config, {logger, config});
      expect(plugin.config.url).toBe('ldap://ldap.example.com');
      expect(plugin.config.baseDN).toBe('ou=People,dc=example,dc=com');
      expect(plugin.config.bindDN).toBe('cn=admin,dc=example,dc=com');
      expect(plugin.config.bindCredentials).toBe('admin');
      expect(plugin.config.groupAttribute).toBe('cn');
      expect(plugin.config.groupSearchFilter).toBe('(member={{userDN}})');
    });
  });

  describe('authenticate', () => {
    test('authenticates user successfully', async () => {
      // User search returns a result
      mockSearchLdap
        .mockResolvedValueOnce([{dn: 'uid=testuser,ou=users,dc=example,dc=org'}])
        // Group search returns groups
        .mockResolvedValueOnce([
          {dn: 'cn=developers,ou=groups,dc=example,dc=org', cn: 'developers'},
          {dn: 'cn=publishers,ou=groups,dc=example,dc=org', cn: 'publishers'},
        ]);

      const plugin = createPlugin();
      const [err, groups] = await cbToPromise((cb) =>
        plugin.authenticate('testuser', 'password', cb)
      );
      expect(err).toBeNull();
      expect(groups).toEqual(['developers', 'publishers']);
    });

    test('rejects when user not found', async () => {
      mockSearchLdap.mockResolvedValueOnce([]);
      const plugin = createPlugin();
      const [err] = await cbToPromise((cb) => plugin.authenticate('unknown', 'password', cb));
      expect(err).toBeTruthy();
    });

    test('rejects when password is wrong', async () => {
      mockSearchLdap.mockResolvedValueOnce([{dn: 'uid=testuser,ou=users,dc=example,dc=org'}]);
      // Second bind (user auth) fails
      mockBindClient
        .mockResolvedValueOnce(undefined) // service account bind OK
        .mockRejectedValueOnce(new Error('Invalid credentials'));

      const plugin = createPlugin();
      const [err] = await cbToPromise((cb) => plugin.authenticate('testuser', 'wrongpassword', cb));
      expect(err).toBeTruthy();
    });

    test('reads groups from userGroupsAttribute (memberOf) without extra search', async () => {
      const config = {
        auth: {
          '@verdaccio/auth-ldap': {
            url: 'ldap://localhost:389',
            baseDN: 'dc=example,dc=org',
            bindDN: 'cn=admin,dc=example,dc=org',
            bindCredentials: 'admin',
            userGroupsAttribute: 'memberOf',
            // groupSearchBase intentionally omitted — memberOf makes it redundant
          },
        },
      } as unknown as Config;
      const plugin = new LdapAuthPlugin(config, {logger, config});

      // User entry carries memberOf values directly (AD-style DNs)
      mockSearchLdap.mockResolvedValueOnce([
        {
          dn: 'CN=Fiehe\\, Christoph,OU=users,DC=example,DC=org',
          memberOf: [
            'CN=GroupA,OU=groups,DC=example,DC=org',
            'CN=GroupB,OU=groups,DC=example,DC=org',
          ],
        },
      ]);

      const [err, groups] = await cbToPromise((cb) =>
        plugin.authenticate('cfiehe', 'password', cb)
      );
      expect(err).toBeNull();
      expect(groups).toEqual(['GroupA', 'GroupB']);
      // Only one search (user lookup) — no separate group search
      expect(mockSearchLdap).toHaveBeenCalledTimes(1);
      // The user search must request the memberOf attribute
      const [, , , requestedAttrs] = mockSearchLdap.mock.calls[0];
      expect(requestedAttrs).toContain('memberOf');
    });

    test('normalizes single-valued userGroupsAttribute to an array', async () => {
      const config = {
        auth: {
          '@verdaccio/auth-ldap': {
            url: 'ldap://localhost:389',
            baseDN: 'dc=example,dc=org',
            userGroupsAttribute: 'memberOf',
          },
        },
      } as unknown as Config;
      const plugin = new LdapAuthPlugin(config, {logger, config});

      mockSearchLdap.mockResolvedValueOnce([
        {
          dn: 'CN=Alice,OU=users,DC=example,DC=org',
          memberOf: 'CN=LoneGroup,OU=groups,DC=example,DC=org',
        },
      ]);

      const [err, groups] = await cbToPromise((cb) => plugin.authenticate('alice', 'pw', cb));
      expect(err).toBeNull();
      expect(groups).toEqual(['LoneGroup']);
    });

    test('userGroupsAttribute returns empty groups when attribute is absent', async () => {
      const config = {
        auth: {
          '@verdaccio/auth-ldap': {
            url: 'ldap://localhost:389',
            baseDN: 'dc=example,dc=org',
            userGroupsAttribute: 'memberOf',
          },
        },
      } as unknown as Config;
      const plugin = new LdapAuthPlugin(config, {logger, config});

      mockSearchLdap.mockResolvedValueOnce([{dn: 'CN=Alice,OU=users,DC=example,DC=org'}]);

      const [err, groups] = await cbToPromise((cb) => plugin.authenticate('alice', 'pw', cb));
      expect(err).toBeNull();
      expect(groups).toEqual([]);
    });

    test('substitutes {{userDN}} (filter-escaped) in groupSearchFilter', async () => {
      const config = {
        auth: {
          '@verdaccio/auth-ldap': {
            url: 'ldap://localhost:389',
            baseDN: 'dc=example,dc=org',
            bindDN: 'cn=admin,dc=example,dc=org',
            bindCredentials: 'admin',
            groupSearchBase: 'ou=groups,dc=example,dc=org',
            groupSearchFilter: '(member={{userDN}})',
          },
        },
      } as unknown as Config;
      const plugin = new LdapAuthPlugin(config, {logger, config});

      // The user DN contains an escaped comma and parentheses — all must be
      // preserved in the DN but filter-escaped when interpolated.
      mockSearchLdap
        .mockResolvedValueOnce([{dn: 'CN=Fiehe\\, Christoph (ext),OU=users,DC=example,DC=org'}])
        .mockResolvedValueOnce([{cn: 'GroupA'}, {cn: 'GroupB'}]);

      const [err, groups] = await cbToPromise((cb) =>
        plugin.authenticate('cfiehe', 'password', cb)
      );
      expect(err).toBeNull();
      expect(groups).toEqual(['GroupA', 'GroupB']);

      // Assert the interpolated group filter — parens are escaped, the DN's
      // own escape sequence (\,) becomes \5c, (, ) → \28, \29.
      const groupSearchCall = mockSearchLdap.mock.calls[1];
      const interpolatedFilter = groupSearchCall[2];
      expect(interpolatedFilter).toBe(
        '(member=CN=Fiehe\\5c, Christoph \\28ext\\29,OU=users,DC=example,DC=org)'
      );
    });

    test('applies groupMapping to memberOf-derived groups', async () => {
      const config = {
        auth: {
          '@verdaccio/auth-ldap': {
            url: 'ldap://localhost:389',
            baseDN: 'dc=example,dc=org',
            userGroupsAttribute: 'memberOf',
            groupMapping: {GroupA: 'developers'},
          },
        },
      } as unknown as Config;
      const plugin = new LdapAuthPlugin(config, {logger, config});

      mockSearchLdap.mockResolvedValueOnce([
        {
          dn: 'CN=Alice,DC=example,DC=org',
          memberOf: ['CN=GroupA,DC=example,DC=org', 'CN=GroupB,DC=example,DC=org'],
        },
      ]);

      const [err, groups] = await cbToPromise((cb) => plugin.authenticate('alice', 'pw', cb));
      expect(err).toBeNull();
      expect(groups).toEqual(['developers', 'GroupB']);
    });

    test('returns empty groups when no groupSearchBase', async () => {
      const config = {
        auth: {
          '@verdaccio/auth-ldap': {
            url: 'ldap://localhost:389',
            baseDN: 'ou=users,dc=example,dc=org',
            bindDN: 'cn=admin,dc=example,dc=org',
            bindCredentials: 'admin',
            // no groupSearchBase
          },
        },
      } as unknown as Config;
      const plugin = new LdapAuthPlugin(config, {logger, config});

      mockSearchLdap.mockResolvedValueOnce([{dn: 'uid=testuser,ou=users,dc=example,dc=org'}]);

      const [err, groups] = await cbToPromise((cb) =>
        plugin.authenticate('testuser', 'password', cb)
      );
      expect(err).toBeNull();
      expect(groups).toEqual([]);
    });
  });

  describe('adduser', () => {
    test('rejects user creation', async () => {
      const plugin = createPlugin();
      const [err] = await cbToPromise((cb) => plugin.adduser('newuser', 'password', cb));
      expect(err).toBeTruthy();
      expect((err as any).message).toContain('disabled');
    });
  });

  describe('allow_access', () => {
    test('allows $all access', async () => {
      const plugin = createPlugin();
      const [err, access] = await cbToPromise((cb) =>
        plugin.allow_access(makeUser('user'), makePkg(['$all']), cb)
      );
      expect(err).toBeNull();
      expect(access).toBe(true);
    });

    test('allows $authenticated for logged-in user', async () => {
      const plugin = createPlugin();
      const [err, access] = await cbToPromise((cb) =>
        plugin.allow_access(makeUser('user'), makePkg(['$authenticated']), cb)
      );
      expect(err).toBeNull();
      expect(access).toBe(true);
    });

    test('denies $authenticated for anonymous user', async () => {
      const plugin = createPlugin();
      const [err] = await cbToPromise((cb) =>
        plugin.allow_access(makeUser(undefined), makePkg(['$authenticated']), cb)
      );
      expect(err).toBeTruthy();
    });

    test('allows access when user has matching group', async () => {
      const plugin = createPlugin();
      const [err, access] = await cbToPromise((cb) =>
        plugin.allow_access(makeUser('user', ['developers']), makePkg(['developers']), cb)
      );
      expect(err).toBeNull();
      expect(access).toBe(true);
    });

    test('denies access when user lacks required group', async () => {
      const plugin = createPlugin();
      const [err] = await cbToPromise((cb) =>
        plugin.allow_access(makeUser('user', ['readers']), makePkg(['admins']), cb)
      );
      expect(err).toBeTruthy();
    });
  });

  describe('allow_publish', () => {
    test('allows publish when user has matching group', async () => {
      const plugin = createPlugin();
      const [err, access] = await cbToPromise((cb) =>
        plugin.allow_publish(makeUser('user', ['publishers']), makePkg([], ['publishers']), cb)
      );
      expect(err).toBeNull();
      expect(access).toBe(true);
    });

    test('denies publish when user lacks required group', async () => {
      const plugin = createPlugin();
      const [err] = await cbToPromise((cb) =>
        plugin.allow_publish(makeUser('user', ['readers']), makePkg([], ['publishers']), cb)
      );
      expect(err).toBeTruthy();
    });
  });

  describe('allow_unpublish', () => {
    test('falls back to publish groups when unpublish is not configured', async () => {
      const plugin = createPlugin();
      const [err, access] = await cbToPromise((cb) =>
        plugin.allow_unpublish(
          makeUser('user', ['publishers']),
          makePkg([], ['publishers'], undefined),
          cb
        )
      );
      expect(err).toBeNull();
      expect(access).toBe(true);
    });
  });
});
