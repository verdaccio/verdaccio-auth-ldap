# @verdaccio/auth-ldap

LDAP / Active Directory authentication plugin for [Verdaccio](https://verdaccio.org).

Authenticates users against an LDAP directory (OpenLDAP, Active Directory, FreeIPA, etc.) and provides group-based access control using LDAP groups.

## Requirements

- **Node.js** >= 24
- **Verdaccio** >= 7.x
- **LDAP server** — OpenLDAP, Active Directory, FreeIPA, 389 Directory Server, etc.

## Installation

```bash
npm install @verdaccio/auth-ldap
```

## Configuration

Add to your Verdaccio `config.yaml`. Since this is a scoped package, use the full package name as the auth key:

```yaml
auth:
  '@verdaccio/auth-ldap':
    # Connection
    url: ldap://ldap.example.com:389 # ldaps:// for TLS
    baseDN: ou=users,dc=example,dc=com # base DN for user searches
    bindDN: cn=readonly,dc=example,dc=com # service account for searching (optional)
    bindCredentials: readonly-password # service account password

    # User search
    searchFilter: '(uid={{username}})' # filter to find user (default: (uid={{username}}))
    usernameAttribute: uid # attribute containing username (default: uid)

    # Group search (optional — enables group-based authorization)
    groupSearchBase: ou=groups,dc=example,dc=com
    groupSearchFilter: '(memberUid={{username}})' # filter to find groups (default: (memberUid={{username}}))
    groupAttribute: cn # attribute containing group name (default: cn)

    # Group mapping (optional — map LDAP group names to friendly names)
    groupMapping:
      'cn=npm-developers,ou=groups,dc=example,dc=com': developers
      'cn=npm-admins,ou=groups,dc=example,dc=com': admins

    # Connection options
    reconnect: true # auto-reconnect (default: true)
    timeout: 5000 # operation timeout in ms (default: 5000)
    connectTimeout: 10000 # connection timeout in ms (default: 10000)

    # TLS options (for ldaps://)
    tlsOptions:
      rejectUnauthorized: true # set to false for self-signed certs
```

### Active Directory configuration

```yaml
auth:
  '@verdaccio/auth-ldap':
    url: ldap://dc01.corp.example.com:389
    baseDN: ou=Users,dc=corp,dc=example,dc=com
    bindDN: cn=svc-verdaccio,ou=ServiceAccounts,dc=corp,dc=example,dc=com
    bindCredentials: LDAP_BIND_PASSWORD
    searchFilter: '(sAMAccountName={{username}})'
    usernameAttribute: sAMAccountName
    groupSearchBase: ou=Groups,dc=corp,dc=example,dc=com
    groupSearchFilter: '(member={{dn}})'
    groupAttribute: cn
```

### Environment variable substitution

Config values can reference environment variables by name:

```yaml
auth:
  '@verdaccio/auth-ldap':
    url: LDAP_URL
    baseDN: LDAP_BASE_DN
    bindDN: LDAP_BIND_DN
    bindCredentials: LDAP_BIND_PASSWORD
    groupSearchBase: LDAP_GROUP_SEARCH_BASE
```

### Package access examples

#### Example 1: Verdaccio packages open, popular packages restricted to admins

Scoped `@verdaccio/*` packages are accessible to all authenticated users, but popular packages like `react`, `jquery`, and `express` are restricted to the `admins` LDAP group:

```yaml
packages:
  # Verdaccio packages — open to all authenticated users
  '@verdaccio/*':
    access: $authenticated
    publish: $authenticated
    proxy: npmjs

  # Popular packages — only admins can publish/unpublish
  'react':
    access: $authenticated
    publish: admins
    unpublish: admins
    proxy: npmjs
  'jquery':
    access: $authenticated
    publish: admins
    unpublish: admins
    proxy: npmjs
  'express':
    access: $authenticated
    publish: admins
    unpublish: admins
    proxy: npmjs

  # Scoped company packages — developers can publish, admins can unpublish
  '@company/*':
    access: $authenticated
    publish: developers
    unpublish: admins

  # Everything else — read from npmjs, only admins can publish
  '**':
    access: $authenticated
    publish: admins
    proxy: npmjs
```

#### Example 2: Public read, restricted write

Anyone can install packages, but only specific LDAP groups can publish:

```yaml
packages:
  '@internal/*':
    access: $authenticated
    publish: developers
    unpublish: admins
  '**':
    access: $all
    publish: admins
    proxy: npmjs
```

#### Example 3: Team-based access

Different teams own different scopes:

```yaml
packages:
  '@frontend/*':
    access: $authenticated
    publish: frontend-team
    unpublish: admins
  '@backend/*':
    access: $authenticated
    publish: backend-team
    unpublish: admins
  '@infra/*':
    access: devops
    publish: devops
    unpublish: admins
  '**':
    access: $authenticated
    publish: admins
    proxy: npmjs
```

### Logging in

#### Basic login

```bash
npm login --registry http://localhost:4873
# Username: your-ldap-username
# Password: your-ldap-password
```

#### Login as admin (OpenLDAP example)

First, ensure an admin user and group exist in LDAP:

```bash
# Create the admins group (if it doesn't exist)
ldapadd -x -H ldap://localhost:389 \
  -D "cn=admin,dc=verdaccio,dc=org" -w admin <<EOF
dn: cn=admins,ou=groups,dc=verdaccio,dc=org
objectClass: posixGroup
cn: admins
gidNumber: 3000
memberUid: adminuser
EOF

# Create an admin user
ldapadd -x -H ldap://localhost:389 \
  -D "cn=admin,dc=verdaccio,dc=org" -w admin <<EOF
dn: uid=adminuser,ou=users,dc=verdaccio,dc=org
objectClass: inetOrgPerson
objectClass: posixAccount
objectClass: shadowAccount
cn: Admin User
sn: Admin
uid: adminuser
uidNumber: 1100
gidNumber: 1100
homeDirectory: /home/adminuser
userPassword: adminpassword
mail: admin@verdaccio.org
EOF
```

Then login:

```bash
npm login --registry http://localhost:4873
# Username: adminuser
# Password: adminpassword
```

The plugin will authenticate against LDAP, find that `adminuser` is a member of the `admins` group, and grant the corresponding permissions.

#### Login as admin (Active Directory example)

```bash
npm login --registry http://localhost:4873
# Username: admin.user          (sAMAccountName)
# Password: your-ad-password
```

The plugin uses the `sAMAccountName` attribute (configured via `searchFilter`) to find the user, then checks AD group membership via the `member` attribute.

#### Verify your groups

After logging in, publish a test package to verify your permissions:

```bash
# Create a minimal test package
mkdir /tmp/test-pkg && cd /tmp/test-pkg
npm init -y --scope=@company
npm publish --registry http://localhost:4873

# If you get "publish not allowed", your user doesn't have the required group
# Enable debug logging to see which groups were returned:
# DEBUG=verdaccio:plugin* verdaccio --config config.yaml
```

#### Using auth tokens in CI/CD

```bash
# Login once to get a token
npm login --registry http://your-verdaccio:4873

# The token is stored in ~/.npmrc — extract it for CI:
grep "_authToken" ~/.npmrc

# In CI, set the token directly:
npm config set //your-verdaccio:4873/:_authToken "YOUR_TOKEN"
npm publish --registry http://your-verdaccio:4873
```

### Environment variables reference

| Variable                 | Required | Description                                 |
| ------------------------ | -------- | ------------------------------------------- |
| `LDAP_URL`               | Yes      | LDAP server URL (ldap:// or ldaps://)       |
| `LDAP_BASE_DN`           | Yes      | Base DN for user searches                   |
| `LDAP_BIND_DN`           | No       | Service account DN for searching            |
| `LDAP_BIND_PASSWORD`     | No       | Service account password                    |
| `LDAP_GROUP_SEARCH_BASE` | No       | Base DN for group searches                  |
| `DEBUG`                  | No       | Set to `verdaccio:plugin*` for debug output |

Available debug namespaces:

- `verdaccio:plugin:ldap` — authentication and authorization decisions
- `verdaccio:plugin:ldap:client` — LDAP bind, search, and connection events
- `verdaccio:plugin:ldap:config` — config value resolution from env vars

## How It Works

### Authentication Flow

```
npm login (username + password)
         │
         ▼
   LdapAuthPlugin.authenticate()
         │
    ┌────┴────────────────────────────┐
    │                                 │
    ▼                                 │
 1. Bind with service account         │
    (for user search)                 │
         │                            │
         ▼                            │
 2. Search for user DN                │
    (uid={{username}})                 │
         │                            │
         ▼                            │
 3. Bind with user DN + password      │
    (verify credentials)              │
         │                            │
         ▼                            │
 4. Search for user groups            │
    (memberUid={{username}})           │
         │                            │
         ▼                            │
 5. Return groups → Verdaccio         │
    ┌────┴────┐                       │
    │         │                       │
allow_access  allow_publish           │
    │         │                       │
    ▼         ▼                       │
 Check user groups vs                 │
 package config                       │
                                      │
              LDAP Server ◄───────────┘
```

## Architecture

```
                   +-----------+
                   | Verdaccio |
                   +-----+-----+
                         |
                  LdapAuthPlugin
                         |
              ┌──────────┴──────────┐
              │                     │
        authenticate()        allow_access/publish()
              │                     │
         LDAP Server           Group check
    ┌─────────────────┐    (user.groups ∩ pkg.access)
    │ 1. bind (svc)   │
    │ 2. search user  │
    │ 3. bind (user)  │
    │ 4. search groups│
    └─────────────────┘
```

## Migrating from verdaccio-ldap

If you are currently using the older `verdaccio-ldap` plugin, you can switch to `@verdaccio/auth-ldap` with minimal configuration changes. The new plugin accepts the legacy config format and automatically normalizes it at startup, emitting deprecation warnings for each legacy property so you can update at your own pace.

### Quick migration

1. Replace the package:

```bash
npm uninstall verdaccio-ldap
npm install @verdaccio/auth-ldap
```

2. Your existing `config.yaml` will work as-is. On startup you will see deprecation warnings guiding you to the new property names.

### What gets migrated automatically

| Legacy property (verdaccio-ldap)   | New property (@verdaccio/auth-ldap) |
| ---------------------------------- | ----------------------------------- |
| `client_options.url`               | `url`                               |
| `client_options.searchBase`        | `baseDN`                            |
| `client_options.adminDn`           | `bindDN`                            |
| `client_options.adminPassword`     | `bindCredentials`                   |
| `client_options.searchFilter`      | `searchFilter`                      |
| `client_options.groupSearchBase`   | `groupSearchBase`                   |
| `client_options.groupSearchFilter` | `groupSearchFilter`                 |
| `client_options.groupDnProperty`   | `groupAttribute`                    |
| `client_options.reconnect`         | `reconnect`                         |
| `groupNameAttribute`               | `groupAttribute`                    |
| `{{dn}}` in groupSearchFilter      | `{{username}}`                      |
| env var `LDAP_ADMIN_PASS`          | `bindCredentials`                   |

The following legacy options are dropped with a warning since they are no longer needed:

- `cache` — Verdaccio handles session management
- `searchAttributes` — the plugin requests only the attributes it needs
- `type: ldap` — removed silently

### Configuration before and after

**Before** (verdaccio-ldap):

```yaml
auth:
  ldap:
    type: ldap
    groupNameAttribute: cn
    cache:
      size: 100
      expire: 300
    client_options:
      url: ldap://ldap.example.com
      adminDn: cn=admin,dc=example,dc=com
      adminPassword: admin
      searchBase: ou=People,dc=example,dc=com
      searchFilter: '(uid={{username}})'
      groupDnProperty: cn
      groupSearchBase: ou=groups,dc=example,dc=com
      groupSearchFilter: '(memberUid={{dn}})'
      searchAttributes: ['*', 'memberOf']
      reconnect: true
```

**After** (@verdaccio/auth-ldap — recommended):

```yaml
auth:
  '@verdaccio/auth-ldap':
    url: ldap://ldap.example.com
    baseDN: ou=People,dc=example,dc=com
    bindDN: cn=admin,dc=example,dc=com
    bindCredentials: admin
    searchFilter: '(uid={{username}})'
    groupAttribute: cn
    groupSearchBase: ou=groups,dc=example,dc=com
    groupSearchFilter: '(memberUid={{username}})'
    reconnect: true
```

Both configurations produce identical behavior. The "before" format will continue to work but will emit deprecation warnings on startup.

### New features in @verdaccio/auth-ldap

These features are not available in the old plugin:

- **Group mapping** — map LDAP group DNs to friendly names via `groupMapping`
- **Environment variable substitution** — any config value can reference an env var by name
- **Explicit access control** — `allow_access`, `allow_publish`, and `allow_unpublish` with support for `$all`, `$authenticated`, and `$anonymous` tokens
- **Configurable timeouts** — `timeout` and `connectTimeout` options
- **TLS options** — explicit `tlsOptions.rejectUnauthorized` for self-signed certificates

## Development

See [LOCAL_DEV.md](LOCAL_DEV.md) for the full local development guide, including:

- Setup, build, test, and lint commands
- Running Verdaccio + OpenLDAP via Docker Compose
- Pre-seeded test users and groups
- Inspecting LDAP data with ldapsearch
- Debug logging namespaces

## License

MIT
