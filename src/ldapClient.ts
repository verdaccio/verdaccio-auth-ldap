import {Client} from 'ldapts';
import type {Entry} from 'ldapts';
import debugCore from 'debug';

import type {LdapConfig} from '../types';

const debug = debugCore('verdaccio:plugin:ldap:client');

export type {Entry};

export function createLdapClient(config: LdapConfig): Client {
  debug(
    'creating LDAP client url=%o timeout=%o',
    config.url,
    config.timeout || 5000
  );

  return new Client({
    url: config.url,
    timeout: config.timeout || 5000,
    connectTimeout: config.connectTimeout || 10000,
    tlsOptions: config.tlsOptions,
  });
}

export async function bindClient(client: Client, dn: string, password: string): Promise<void> {
  debug('binding dn=%o', dn);
  await client.bind(dn, password);
  debug('bind success dn=%o', dn);
}

export async function searchLdap(
  client: Client,
  base: string,
  filter: string,
  attributes: string[],
  scope: 'base' | 'one' | 'sub' = 'sub'
): Promise<Entry[]> {
  debug('searching base=%o filter=%o scope=%o', base, filter, scope);
  const {searchEntries} = await client.search(base, {
    filter,
    scope,
    attributes,
  });
  debug('search complete, found %d entries', searchEntries.length);
  return searchEntries;
}

export async function unbindClient(client: Client): Promise<void> {
  try {
    await client.unbind();
    debug('unbind success');
  } catch (err: any) {
    debug('unbind error: %o', err.message);
  }
}
