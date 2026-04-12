import {describe, test, expect, vi} from 'vitest';
import {createLdapClient} from '../src/ldapClient';
import type {LdapConfig} from '../types';

vi.mock('ldapts', () => {
  return {
    Client: class MockClient {
      bind = vi.fn();
      search = vi.fn().mockResolvedValue({searchEntries: []});
      unbind = vi.fn();
    },
  };
});

function makeConfig(overrides: Partial<LdapConfig> = {}): LdapConfig {
  return {
    url: 'ldap://localhost:389',
    baseDN: 'dc=example,dc=org',
    ...overrides,
  } as LdapConfig;
}

describe('createLdapClient', () => {
  test('creates a client with default options', () => {
    const client = createLdapClient(makeConfig());
    expect(client).toBeDefined();
  });

  test('creates a client with custom timeouts', () => {
    const client = createLdapClient(
      makeConfig({timeout: 3000, connectTimeout: 5000})
    );
    expect(client).toBeDefined();
  });

  test('creates a client with TLS options', () => {
    const client = createLdapClient(
      makeConfig({tlsOptions: {rejectUnauthorized: false}})
    );
    expect(client).toBeDefined();
  });
});
