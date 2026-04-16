import {createRegistryConfig, signinTests} from '@verdaccio/e2e-ui';

const registryUrl = Cypress.env('VERDACCIO_URL') || 'http://localhost:4873';
const ldapUser = Cypress.env('LDAP_USER') || 'testuser';
const ldapPassword = Cypress.env('LDAP_PASSWORD') || 'testpassword';

const config = createRegistryConfig({
  registryUrl,
  credentials: {user: ldapUser, password: ldapPassword},
});

signinTests(config);

describe('LDAP API login', () => {
  it(`should obtain a token via PUT /-/user/org.couchdb.user:${ldapUser}`, () => {
    cy.request({
      method: 'PUT',
      url: `${registryUrl}/-/user/org.couchdb.user:${ldapUser}`,
      headers: {'content-type': 'application/json'},
      body: {name: ldapUser, password: ldapPassword},
    }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body).to.have.property('token');
      expect(res.body.token).to.be.a('string').and.not.be.empty;
    });
  });

  it('should reject invalid LDAP credentials', () => {
    cy.request({
      method: 'PUT',
      url: `${registryUrl}/-/user/org.couchdb.user:${ldapUser}`,
      headers: {'content-type': 'application/json'},
      body: {name: ldapUser, password: 'wrongpassword'},
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.be.oneOf([401, 409]);
    });
  });

  it('should reject a user that does not exist in LDAP', () => {
    cy.request({
      method: 'PUT',
      url: `${registryUrl}/-/user/org.couchdb.user:nonexistent`,
      headers: {'content-type': 'application/json'},
      body: {name: 'nonexistent', password: 'anything'},
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.be.oneOf([401, 409]);
    });
  });
});
