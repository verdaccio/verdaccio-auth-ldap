---
'@verdaccio/auth-ldap': patch
---

Return a boolean success value from the registration callback, as required by the Verdaccio authentication plugin contract. Existing LDAP users can still obtain tokens, while users remain managed in LDAP.
