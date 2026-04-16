import {join} from 'node:path';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';

import {defineConfig} from 'cypress';
import {setupVerdaccioTasks} from '@verdaccio/e2e-ui';

const registryUrl = process.env.VERDACCIO_URL || 'http://localhost:4873';
const ldapUser = process.env.LDAP_USER || 'testuser';
const ldapPassword = process.env.LDAP_PASSWORD || 'testpassword';

/**
 * Obtain a token via PUT /-/user/org.couchdb.user:<name> using
 * the LDAP user credentials instead of creating throwaway users.
 */
async function obtainLdapToken(): Promise<{user: string; token: string}> {
  const url = `${registryUrl.replace(/\/$/, '')}/-/user/org.couchdb.user:${ldapUser}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      name: ldapUser,
      password: ldapPassword,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LDAP login failed (HTTP ${res.status}): ${body}`);
  }
  const json = (await res.json()) as {token?: string};
  if (!json.token) {
    throw new Error(`Login response missing token: ${JSON.stringify(json)}`);
  }
  return {user: ldapUser, token: json.token};
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, '-');
}

async function createTempProject(
  pkgName: string,
  version: string,
  token: string,
  deps: Record<string, string>,
  devDeps: Record<string, string>
): Promise<string> {
  const tempFolder = await mkdtemp(join(tmpdir(), `verdaccio-e2e-ldap-${sanitize(pkgName)}-`));
  const manifest = {
    name: pkgName,
    version,
    description: `e2e test fixture ${pkgName}`,
    main: 'index.js',
    dependencies: deps,
    devDependencies: devDeps,
    keywords: ['verdaccio', 'e2e', 'test'],
    author: 'Verdaccio E2E <verdaccio@example.org>',
    license: 'MIT',
    publishConfig: {access: 'public', registry: registryUrl},
  };
  await writeFile(join(tempFolder, 'package.json'), JSON.stringify(manifest, null, 2));
  await writeFile(
    join(tempFolder, 'README.md'),
    `# ${pkgName}\n\nPublished by @verdaccio/e2e-ui for e2e testing.\n`
  );
  await writeFile(join(tempFolder, 'index.js'), `module.exports = ${JSON.stringify(pkgName)};\n`);
  const registryHost = registryUrl.replace(/^https?:/, '');
  const npmrc = [
    `registry=${registryUrl}`,
    `${registryHost}/:_authToken=${token}`,
    'access=public',
    '',
  ].join('\n');
  await writeFile(join(tempFolder, '.npmrc'), npmrc);
  return tempFolder;
}

function spawnNpmPublish(cwd: string): Promise<{stdout: string; stderr: string; exitCode: number}> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['publish', '--registry', registryUrl, '--tag', 'e2e'], {cwd});
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => (stdout += c));
    proc.stderr.on('data', (c) => (stderr += c));
    proc.on('error', reject);
    proc.on('close', (code) => resolve({stdout, stderr, exitCode: code ?? -1}));
  });
}

export default defineConfig({
  e2e: {
    baseUrl: registryUrl,
    setupNodeEvents(on) {
      // Register the standard tasks first
      setupVerdaccioTasks(on, {
        registryUrl,
        credentials: {user: ldapUser, password: ldapPassword},
      });

      // Override publish/unpublish tasks to use LDAP auth instead of throwaway users
      on('task', {
        async publishPackage(input: {
          pkgName: string;
          version?: string;
          unique?: boolean;
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        }) {
          const baseVersion = input.version ?? '1.0.0';
          const version = input.unique ? `${baseVersion}-t${Date.now()}` : baseVersion;
          const {token} = await obtainLdapToken();
          const tempFolder = await createTempProject(
            input.pkgName,
            version,
            token,
            input.dependencies ?? {},
            input.devDependencies ?? {}
          );
          const {stdout, stderr, exitCode} = await spawnNpmPublish(tempFolder);
          if (exitCode !== 0) {
            throw new Error(
              `npm publish failed for ${input.pkgName}@${version} (exit ${exitCode}):\n${stderr || stdout}`
            );
          }
          return {pkgName: input.pkgName, version, tempFolder, stdout, stderr, exitCode};
        },

        async unpublishPackage(input: {pkgName: string; tempFolder?: string} | string) {
          const pkgName = typeof input === 'string' ? input : input.pkgName;
          const {token} = await obtainLdapToken();
          const tempFolder = await mkdtemp(join(tmpdir(), `verdaccio-e2e-ldap-unpub-`));
          const host = new URL(registryUrl).host;
          await writeFile(
            join(tempFolder, '.npmrc'),
            `//${host}/:_authToken=${token}\nregistry=${registryUrl}\n`
          );
          return new Promise((resolve, reject) => {
            const proc = spawn(
              'npm',
              ['unpublish', pkgName, '--force', '--registry', registryUrl],
              {cwd: tempFolder}
            );
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (c) => (stdout += c));
            proc.stderr.on('data', (c) => (stderr += c));
            proc.on('error', reject);
            proc.on('close', async (code) => {
              await rm(tempFolder, {recursive: true, force: true}).catch(() => {});
              const alreadyGone =
                (stderr + stdout).includes('404') || (stderr + stdout).includes('not found');
              resolve({pkgName, stdout, stderr, exitCode: code ?? -1, alreadyGone});
            });
          });
        },
      });
    },
  },
  env: {
    VERDACCIO_URL: registryUrl,
    LDAP_USER: ldapUser,
    LDAP_PASSWORD: ldapPassword,
  },
});
