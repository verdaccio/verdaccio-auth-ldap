# @verdaccio/auth-ldap

## 1.3.0

### Minor Changes

- 7b6b418: Fix group resolution for Active Directory (#3).

  Two new ways to resolve group membership against backends — notably AD —
  where `member` holds the user's DN rather than the login name:
  - **`userGroupsAttribute` (recommended)** — when set (e.g. `memberOf`),
    groups are read directly from the authenticated user entry and the
    separate group search is skipped entirely. DN-shaped values are reduced
    to the first RDN (e.g. `CN=GroupA,OU=…` → `GroupA`).
  - **`{{userDN}}` placeholder** — `groupSearchFilter` now accepts
    `{{userDN}}`, replaced with the authenticated user's DN (LDAP-filter
    escaped per RFC 4515). Use this when `memberOf` isn't available.

  Legacy migration: the old `verdaccio-ldap` plugin's `{{dn}}` placeholder
  referred to the user's DN, not the login name — it now migrates to
  `{{userDN}}` (previously it was incorrectly rewritten to `{{username}}`).

## 1.2.0

### Minor Changes

- 6b22ea2: Fix group resolution for Active Directory (#3).

  Two new ways to resolve group membership against backends — notably AD —
  where `member` holds the user's DN rather than the login name:
  - **`userGroupsAttribute` (recommended)** — when set (e.g. `memberOf`),
    groups are read directly from the authenticated user entry and the
    separate group search is skipped entirely. DN-shaped values are reduced
    to the first RDN (e.g. `CN=GroupA,OU=…` → `GroupA`).
  - **`{{userDN}}` placeholder** — `groupSearchFilter` now accepts
    `{{userDN}}`, replaced with the authenticated user's DN (LDAP-filter
    escaped per RFC 4515). Use this when `memberOf` isn't available.

  Legacy migration: the old `verdaccio-ldap` plugin's `{{dn}}` placeholder
  referred to the user's DN, not the login name — it now migrates to
  `{{userDN}}` (previously it was incorrectly rewritten to `{{username}}`).

## 1.1.0

### Minor Changes

- c65c59f: feat: initial LDAP / Active Directory authentication plugin for Verdaccio

### Patch Changes

- c65c59f: chore: first release
- 321efef: chore: initial release
