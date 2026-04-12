import {describe, test, expect, afterEach} from 'vitest';
import setConfigValue from '../src/setConfigValue';

describe('setConfigValue', () => {
  const envKey = 'TEST_VERDACCIO_CONFIG_VALUE';

  afterEach(() => {
    delete process.env[envKey];
  });

  test('returns the config value when env var is not set', () => {
    expect(setConfigValue('ldap://localhost')).toBe('ldap://localhost');
  });

  test('returns environment variable value when set', () => {
    process.env[envKey] = 'ldap://production:389';
    expect(setConfigValue(envKey)).toBe('ldap://production:389');
  });

  test('returns config value when env var is empty string', () => {
    process.env[envKey] = '';
    expect(setConfigValue(envKey)).toBe(envKey);
  });

  test('handles undefined config value', () => {
    expect(setConfigValue(undefined)).toBe(undefined);
  });
});
