import type {Config} from '@verdaccio/types';

export interface LdapConfig extends Config {
  url: string;
  baseDN: string;
  bindDN?: string;
  bindCredentials?: string;
  searchFilter?: string;
  groupSearchBase?: string;
  groupSearchFilter?: string;
  groupAttribute?: string;
  usernameAttribute?: string;
  tlsOptions?: {
    rejectUnauthorized?: boolean;
  };
  reconnect?: boolean;
  timeout?: number;
  connectTimeout?: number;
  groupMapping?: Record<string, string>;
}

/**
 * Legacy configuration from verdaccio-ldap (v6.x).
 * These properties are accepted for backward compatibility and
 * normalized to LdapConfig via migrateLegacyConfig().
 */
export interface LegacyLdapConfig {
  type?: string;
  groupNameAttribute?: string;
  cache?: {size?: number; expire?: number};
  client_options?: {
    url?: string;
    adminDn?: string;
    adminPassword?: string;
    searchBase?: string;
    searchFilter?: string;
    groupDnProperty?: string;
    groupSearchBase?: string;
    groupSearchFilter?: string;
    searchAttributes?: string[];
    reconnect?: boolean;
    log?: any;
    cache?: boolean;
  };
}
