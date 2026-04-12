import {join} from 'node:path';

import {describe, expect, test} from 'vitest';

import {verifyPlugin} from '@verdaccio/plugin-verifier';

describe('Plugin loading verification', () => {
  test('should be loadable by verdaccio as an auth plugin', async () => {
    const result = await verifyPlugin({
      pluginPath: 'ldap',
      category: 'auth',
      pluginsFolder: join(import.meta.dirname, '..', '..'),
      pluginConfig: {
        url: 'ldap://localhost:389',
        baseDN: 'dc=example,dc=org',
      },
    });

    expect(result.success).toBe(true);
    expect(result.pluginsLoaded).toBe(1);
  });
});
