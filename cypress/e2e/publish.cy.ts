import {createRegistryConfig, publishTests} from '@verdaccio/e2e-ui';

const registryUrl = Cypress.env('VERDACCIO_URL') || 'http://localhost:4873';
const config = createRegistryConfig({
  registryUrl,
  credentials: {user: 'testuser', password: 'testpassword'},
  features: {
    publish: {
      // Tarball download requires $authenticated; browser clicks don't carry the token
      downloadTarball: false,
    },
  },
});

publishTests(config);
