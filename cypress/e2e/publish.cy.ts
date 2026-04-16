import {createRegistryConfig, publishTests} from '@verdaccio/e2e-ui';

const registryUrl = Cypress.env('VERDACCIO_URL') || 'http://localhost:4873';
const ldapUser = Cypress.env('LDAP_USER') || 'testuser';
const ldapPassword = Cypress.env('LDAP_PASSWORD') || 'testpassword';

const config = createRegistryConfig({
  registryUrl,
  credentials: {user: ldapUser, password: ldapPassword},
  features: {
    publish: {
      // Tarball download requires $authenticated; browser clicks don't carry the token
      downloadTarball: false,
    },
  },
});

publishTests(config);
