# Local Development

Guide for developing and testing the `verdaccio-ldap` plugin locally.

## Prerequisites

- Node.js >= 24 (see `.nvmrc`)
- [pnpm](https://pnpm.io/) >= 9
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (for running Verdaccio + OpenLDAP)

## Setup

```bash
# Install dependencies
pnpm install

# Type-check
pnpm type-check

# Lint
pnpm lint

# Build (ESM via Vite 8)
pnpm build

# Run unit tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Format code
pnpm format
```

## Project structure

```
src/
  index.ts              # barrel export
  ldapAuthPlugin.ts     # main plugin (authenticate, allow_access, allow_publish)
  ldapClient.ts         # LDAP client helpers (bind, search, unbind)
  setConfigValue.ts     # env var resolution
types/
  index.ts              # LdapConfig interface
tests/                  # unit tests (vitest 4)
conf/                   # verdaccio config (baked into Docker image)
```

## Running locally with Docker

The included `docker-compose.yaml` provides a full local setup with:

- **OpenLDAP** (`osixia/openldap:1.5.0`) — LDAP server with pre-seeded data
- **seed-ldap** — one-shot container that creates test users and groups
- **Verdaccio** (`7.x-next`) — runs with the plugin built and installed

### First run

```bash
# Build and start everything
docker compose up -d --build

# Verdaccio will be available at http://localhost:4873
# OpenLDAP will be available at ldap://localhost:389
```

### What happens on startup

1. OpenLDAP starts with domain `verdaccio.org` (base DN: `dc=verdaccio,dc=org`)
2. `seed-ldap` waits for OpenLDAP to be healthy, then creates:
   - `ou=users,dc=verdaccio,dc=org` — users organizational unit
   - `ou=groups,dc=verdaccio,dc=org` — groups organizational unit
   - `uid=testuser` — test user (password: `testpassword`)
   - `cn=developers` — group with `testuser` as member
   - `cn=publishers` — group with `testuser` as member
3. The `Dockerfile` builds the plugin and installs it into Verdaccio
4. Verdaccio starts with the plugin configured to authenticate against OpenLDAP

### Pre-seeded test data

| Type  | DN                                            | Details                  |
| ----- | --------------------------------------------- | ------------------------ |
| User  | `uid=testuser,ou=users,dc=verdaccio,dc=org`   | password: `testpassword` |
| Group | `cn=developers,ou=groups,dc=verdaccio,dc=org` | members: `testuser`      |
| Group | `cn=publishers,ou=groups,dc=verdaccio,dc=org` | members: `testuser`      |
| Admin | `cn=admin,dc=verdaccio,dc=org`                | password: `admin`        |

### Testing the local setup

```bash
# Login with the test user
npm login --registry http://localhost:4873
# Username: testuser
# Password: testpassword

# Publish a package
npm publish --registry http://localhost:4873

# Install a package
npm install your-package --registry http://localhost:4873
```

### Inspecting LDAP data

```bash
# Search all users
ldapsearch -x -H ldap://localhost:389 \
  -D "cn=admin,dc=verdaccio,dc=org" -w admin \
  -b "ou=users,dc=verdaccio,dc=org" "(objectClass=inetOrgPerson)"

# Search all groups
ldapsearch -x -H ldap://localhost:389 \
  -D "cn=admin,dc=verdaccio,dc=org" -w admin \
  -b "ou=groups,dc=verdaccio,dc=org" "(objectClass=posixGroup)"

# Search groups for a specific user
ldapsearch -x -H ldap://localhost:389 \
  -D "cn=admin,dc=verdaccio,dc=org" -w admin \
  -b "ou=groups,dc=verdaccio,dc=org" "(memberUid=testuser)" cn

# Add a new user
ldapadd -x -H ldap://localhost:389 \
  -D "cn=admin,dc=verdaccio,dc=org" -w admin <<EOF
dn: uid=newuser,ou=users,dc=verdaccio,dc=org
objectClass: inetOrgPerson
objectClass: posixAccount
objectClass: shadowAccount
cn: New User
sn: User
uid: newuser
uidNumber: 1001
gidNumber: 1001
homeDirectory: /home/newuser
userPassword: newpassword
EOF
```

### Rebuilding after code changes

```bash
docker compose up -d --build
```

### Stopping and cleaning up

```bash
# Stop all containers
docker compose down

# Stop and remove volumes (wipes LDAP data)
docker compose down -v
```

## Debug logging

The plugin uses the [`debug`](https://www.npmjs.com/package/debug) package:

```bash
DEBUG=verdaccio:plugin* docker compose up -d
```

Available namespaces:

| Namespace                      | What it logs                                     |
| ------------------------------ | ------------------------------------------------ |
| `verdaccio:plugin:ldap`        | Authentication and authorization decisions       |
| `verdaccio:plugin:ldap:client` | LDAP bind, search, unbind, and connection events |
| `verdaccio:plugin:ldap:config` | Config value resolution from env vars            |
