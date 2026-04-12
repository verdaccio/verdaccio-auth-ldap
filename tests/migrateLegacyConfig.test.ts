import {describe, test, expect, vi, beforeEach, afterEach} from 'vitest';
import type {Logger} from '@verdaccio/types';

import migrateLegacyConfig from '../src/migrateLegacyConfig';

const logger: Logger = {
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  child: vi.fn(),
  http: vi.fn(),
  trace: vi.fn(),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('migrateLegacyConfig', () => {
  describe('client_options flattening', () => {
    test('flattens client_options into top-level config', () => {
      const result = migrateLegacyConfig(
        {
          client_options: {
            url: 'ldap://localhost',
            searchBase: 'ou=users,dc=test',
            adminDn: 'cn=admin,dc=test',
            adminPassword: 'secret',
            groupSearchBase: 'ou=groups,dc=test',
            groupSearchFilter: '(memberUid={{username}})',
            reconnect: true,
          },
        },
        logger
      );

      expect(result.url).toBe('ldap://localhost');
      expect(result.baseDN).toBe('ou=users,dc=test');
      expect(result.bindDN).toBe('cn=admin,dc=test');
      expect(result.bindCredentials).toBe('secret');
      expect(result.groupSearchBase).toBe('ou=groups,dc=test');
      expect(result.reconnect).toBe(true);
      expect(result.client_options).toBeUndefined();
    });

    test('top-level properties take precedence over client_options', () => {
      const result = migrateLegacyConfig(
        {
          url: 'ldap://override',
          client_options: {
            url: 'ldap://from-client-options',
          },
        },
        logger
      );

      expect(result.url).toBe('ldap://override');
    });

    test('drops internal ldapauth-fork options (log, cache)', () => {
      const result = migrateLegacyConfig(
        {
          client_options: {
            url: 'ldap://localhost',
            log: {trace: () => {}},
            cache: false,
          },
        },
        logger
      );

      expect(result.log).toBeUndefined();
      expect(result.cache).toBeUndefined();
    });

    test('emits deprecation warning for client_options', () => {
      migrateLegacyConfig({client_options: {url: 'ldap://localhost'}}, logger);
      expect(logger.warn).toHaveBeenCalledWith(
        {},
        expect.stringContaining('client_options')
      );
    });
  });

  describe('property aliases', () => {
    test('renames searchBase to baseDN', () => {
      const result = migrateLegacyConfig({searchBase: 'ou=users,dc=test'}, logger);
      expect(result.baseDN).toBe('ou=users,dc=test');
      expect(result.searchBase).toBeUndefined();
    });

    test('renames adminDn to bindDN', () => {
      const result = migrateLegacyConfig({adminDn: 'cn=admin,dc=test'}, logger);
      expect(result.bindDN).toBe('cn=admin,dc=test');
      expect(result.adminDn).toBeUndefined();
    });

    test('renames adminPassword to bindCredentials', () => {
      const result = migrateLegacyConfig({adminPassword: 'secret'}, logger);
      expect(result.bindCredentials).toBe('secret');
      expect(result.adminPassword).toBeUndefined();
    });

    test('renames groupDnProperty to groupAttribute', () => {
      const result = migrateLegacyConfig({groupDnProperty: 'cn'}, logger);
      expect(result.groupAttribute).toBe('cn');
      expect(result.groupDnProperty).toBeUndefined();
    });

    test('renames groupNameAttribute to groupAttribute', () => {
      const result = migrateLegacyConfig({groupNameAttribute: 'cn'}, logger);
      expect(result.groupAttribute).toBe('cn');
      expect(result.groupNameAttribute).toBeUndefined();
    });

    test('new property wins when both old and new are present', () => {
      const result = migrateLegacyConfig(
        {baseDN: 'ou=new', searchBase: 'ou=old'},
        logger
      );
      expect(result.baseDN).toBe('ou=new');
      expect(result.searchBase).toBeUndefined();
    });

    test('emits deprecation warning per alias', () => {
      migrateLegacyConfig(
        {searchBase: 'ou=users', adminDn: 'cn=admin'},
        logger
      );
      expect(logger.warn).toHaveBeenCalledWith(
        {},
        expect.stringContaining('"searchBase" is deprecated')
      );
      expect(logger.warn).toHaveBeenCalledWith(
        {},
        expect.stringContaining('"adminDn" is deprecated')
      );
    });
  });

  describe('{{dn}} replacement', () => {
    test('replaces {{dn}} with {{username}} in groupSearchFilter', () => {
      const result = migrateLegacyConfig(
        {groupSearchFilter: '(memberUid={{dn}})'},
        logger
      );
      expect(result.groupSearchFilter).toBe('(memberUid={{username}})');
    });

    test('replaces multiple {{dn}} occurrences', () => {
      const result = migrateLegacyConfig(
        {groupSearchFilter: '(|(member={{dn}})(uniqueMember={{dn}}))'},
        logger
      );
      expect(result.groupSearchFilter).toBe(
        '(|(member={{username}})(uniqueMember={{username}}))'
      );
    });

    test('leaves {{username}} unchanged', () => {
      const result = migrateLegacyConfig(
        {groupSearchFilter: '(memberUid={{username}})'},
        logger
      );
      expect(result.groupSearchFilter).toBe('(memberUid={{username}})');
      // No warning about {{dn}} since it's not present
      const dnWarnings = (logger.warn as any).mock.calls.filter(
        ([, msg]: [any, string]) => msg.includes('{{dn}}')
      );
      expect(dnWarnings).toHaveLength(0);
    });
  });

  describe('LDAP_ADMIN_PASS env var', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    test('reads bindCredentials from LDAP_ADMIN_PASS env var', () => {
      process.env = {...originalEnv, LDAP_ADMIN_PASS: 'env-secret'};
      const result = migrateLegacyConfig({}, logger);
      expect(result.bindCredentials).toBe('env-secret');
    });

    test('does not override explicit bindCredentials', () => {
      process.env = {...originalEnv, LDAP_ADMIN_PASS: 'env-secret'};
      const result = migrateLegacyConfig({bindCredentials: 'explicit'}, logger);
      expect(result.bindCredentials).toBe('explicit');
    });
  });

  describe('removed options', () => {
    test('drops cache config with warning', () => {
      const result = migrateLegacyConfig(
        {cache: {size: 100, expire: 300}},
        logger
      );
      expect(result.cache).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        {},
        expect.stringContaining('"cache" is deprecated')
      );
    });

    test('drops searchAttributes with warning', () => {
      const result = migrateLegacyConfig(
        {searchAttributes: ['*', 'memberOf']},
        logger
      );
      expect(result.searchAttributes).toBeUndefined();
    });

    test('drops type: ldap silently', () => {
      const result = migrateLegacyConfig({type: 'ldap'}, logger);
      expect(result.type).toBeUndefined();
    });
  });

  describe('full verdaccio-ldap config migration', () => {
    test('migrates a complete verdaccio-ldap config', () => {
      const legacyConfig = {
        type: 'ldap',
        groupNameAttribute: 'cn',
        cache: {size: 100, expire: 300},
        client_options: {
          url: 'ldap://ldap.example.com',
          adminDn: 'cn=admin,dc=example,dc=com',
          adminPassword: 'admin',
          searchBase: 'ou=People,dc=example,dc=com',
          searchFilter: '(uid={{username}})',
          groupDnProperty: 'cn',
          groupSearchBase: 'ou=groups,dc=myorg,dc=com',
          groupSearchFilter: '(memberUid={{dn}})',
          searchAttributes: ['*', 'memberOf'],
          reconnect: true,
        },
      };

      const result = migrateLegacyConfig(legacyConfig, logger);

      expect(result).toEqual({
        url: 'ldap://ldap.example.com',
        baseDN: 'ou=People,dc=example,dc=com',
        bindDN: 'cn=admin,dc=example,dc=com',
        bindCredentials: 'admin',
        searchFilter: '(uid={{username}})',
        groupAttribute: 'cn',
        groupSearchBase: 'ou=groups,dc=myorg,dc=com',
        groupSearchFilter: '(memberUid={{username}})',
        reconnect: true,
      });
    });
  });
});
