import debugCore from 'debug';

import type {Logger} from '@verdaccio/types';

const debug = debugCore('verdaccio:plugin:ldap:migrate');

/**
 * Property aliases from verdaccio-ldap → verdaccio-auth-ldap.
 * Each entry maps { old key → new key }.
 */
const PROPERTY_ALIASES: Record<string, string> = {
  searchBase: 'baseDN',
  adminDn: 'bindDN',
  adminPassword: 'bindCredentials',
  groupDnProperty: 'groupAttribute',
  groupNameAttribute: 'groupAttribute',
};

const LDAP_ADMIN_PASS_ENV = 'LDAP_ADMIN_PASS';

/**
 * Normalize a verdaccio-ldap configuration into the verdaccio-auth-ldap format.
 *
 * Handles:
 * 1. Flattening `client_options` into top-level properties
 * 2. Renaming legacy property names (searchBase→baseDN, adminDn→bindDN, etc.)
 * 3. Replacing `{{dn}}` with `{{username}}` in groupSearchFilter
 * 4. Reading the legacy LDAP_ADMIN_PASS environment variable
 * 5. Dropping removed options (`cache`, `searchAttributes`, `type`)
 *
 * All legacy usage emits a deprecation warning via the logger.
 */
export default function migrateLegacyConfig(
  raw: Record<string, any>,
  logger: Logger
): Record<string, any> {
  const config = {...raw};
  const warnings: string[] = [];

  // Step 1: Flatten client_options
  if (config.client_options && typeof config.client_options === 'object') {
    warnings.push(
      '"client_options" is deprecated — move its properties to the top level of the ldap auth config'
    );
    debug('flattening client_options into top-level config');

    const clientOpts = {...config.client_options};
    delete config.client_options;

    // client_options properties become top-level (existing top-level wins)
    for (const [key, value] of Object.entries(clientOpts)) {
      if (key === 'log' || key === 'cache') {
        // internal ldapauth-fork options — skip
        continue;
      }
      if (!(key in config)) {
        config[key] = value;
      }
    }
  }

  // Step 2: Rename legacy properties
  for (const [oldKey, newKey] of Object.entries(PROPERTY_ALIASES)) {
    if (oldKey in config && !(newKey in config)) {
      warnings.push(`"${oldKey}" is deprecated — use "${newKey}" instead`);
      debug('renaming %o → %o', oldKey, newKey);
      config[newKey] = config[oldKey];
      delete config[oldKey];
    } else if (oldKey in config && newKey in config) {
      // Both present — new key wins, drop old
      warnings.push(`"${oldKey}" is deprecated and ignored because "${newKey}" is already set`);
      delete config[oldKey];
    }
  }

  // Step 3: Replace {{dn}} with {{username}} in groupSearchFilter
  if (typeof config.groupSearchFilter === 'string' && config.groupSearchFilter.includes('{{dn}}')) {
    warnings.push(
      '"{{dn}}" placeholder in groupSearchFilter is deprecated — use "{{username}}" instead'
    );
    debug('replacing {{dn}} with {{username}} in groupSearchFilter');
    config.groupSearchFilter = config.groupSearchFilter.replace(/\{\{dn\}\}/g, '{{username}}');
  }

  // Step 4: Legacy LDAP_ADMIN_PASS environment variable
  if (LDAP_ADMIN_PASS_ENV in process.env && !config.bindCredentials) {
    warnings.push(
      `env var "${LDAP_ADMIN_PASS_ENV}" is deprecated — use setConfigValue pattern (set bindCredentials to an env var name) instead`
    );
    debug('reading bindCredentials from legacy env var %o', LDAP_ADMIN_PASS_ENV);
    config.bindCredentials = process.env[LDAP_ADMIN_PASS_ENV];
  }

  // Step 5: Drop removed options with warnings
  if ('cache' in config) {
    warnings.push(
      '"cache" is deprecated and ignored — verdaccio-auth-ldap relies on Verdaccio session management'
    );
    delete config.cache;
  }

  if ('searchAttributes' in config) {
    warnings.push('"searchAttributes" is deprecated and ignored');
    delete config.searchAttributes;
  }

  if (config.type === 'ldap') {
    delete config.type;
  }

  // Emit all warnings
  for (const msg of warnings) {
    logger.warn({}, `ldap: [migration] ${msg}`);
  }

  return config;
}
