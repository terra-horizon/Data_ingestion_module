const test = require('node:test');
const assert = require('node:assert/strict');
const CdseAuthService = require('../src/services/copernicus/cdse-auth.service');

test('CdseAuthService builds client credentials token request and extracts token', async () => {
  const calls = [];
  const service = new CdseAuthService({
    tokenUrl: 'http://mock/token',
    credentialSets: [{ label: 'primary', clientId: 'client-a', clientSecret: 'secret-a' }],
    httpClient: {
      post: async (url, body, options) => {
        calls.push({ url, body, options });
        return { status: 200, data: { access_token: 'token-a', expires_in: 60 } };
      }
    }
  });

  const token = await service.getAccessToken();

  assert.equal(token, 'token-a');
  assert.equal(calls[0].url, 'http://mock/token');
  assert.equal(calls[0].body, 'grant_type=client_credentials&client_id=client-a&client_secret=secret-a');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
});

test('CdseAuthService fails cleanly when credentials are missing', async () => {
  const service = new CdseAuthService({
    credentialSets: [],
    httpClient: { post: async () => ({ status: 200, data: {} }) }
  });

  await assert.rejects(
    () => service.getAccessToken(),
    (error) => error.code === 'COPERNICUS_AUTH_MISSING'
  );
});

test('CdseAuthService rotates to backup credentials', () => {
  const service = new CdseAuthService({
    credentialSets: [
      { label: 'primary', clientId: 'client-a', clientSecret: 'secret-a' },
      { label: 'backup', clientId: 'client-b', clientSecret: 'secret-b' }
    ],
    httpClient: { post: async () => ({ status: 200, data: { access_token: 'token' } }) }
  });

  assert.equal(service.currentCredential().clientId, 'client-a');
  assert.equal(service.rotateCredential(), true);
  assert.equal(service.currentCredential().clientId, 'client-b');
  assert.equal(service.rotateCredential(), false);
});
