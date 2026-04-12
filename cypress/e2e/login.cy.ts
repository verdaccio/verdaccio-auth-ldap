import {createRegistryConfig, signinTests} from '@verdaccio/e2e-ui';

const registryUrl = Cypress.env('VERDACCIO_URL') || 'http://localhost:4873';
const config = createRegistryConfig({
  registryUrl,
  credentials: {user: 'testuser', password: 'testpassword'},
});

signinTests(config);

describe('LDAP API login', () => {
  it('should obtain a token via PUT /-/user/org.couchdb.user:testuser', () => {
    cy.request({
      method: 'PUT',
      url: `${registryUrl}/-/user/org.couchdb.user:testuser`,
      headers: {'content-type': 'application/json'},
      body: {name: 'testuser', password: 'testpassword'},
    }).then((res) => {
      expect(res.status).to.eq(201);
      expect(res.body).to.have.property('token');
      expect(res.body.token).to.be.a('string').and.not.be.empty;
    });
  });

  it('should reject invalid LDAP credentials', () => {
    cy.request({
      method: 'PUT',
      url: `${registryUrl}/-/user/org.couchdb.user:testuser`,
      headers: {'content-type': 'application/json'},
      body: {name: 'testuser', password: 'wrongpassword'},
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
