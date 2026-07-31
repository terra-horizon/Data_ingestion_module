const test = require('node:test');
const assert = require('node:assert/strict');
const CopernicusAdapter = require('../src/sources/copernicus.adapter');
const CopernicusAuth = require('../src/sources/copernicus-auth');
const { normalizeRequest } = require('../src/handlers/request-normalizer');
const { observationPayload } = require('../test-support/helpers');

function config(overrides = {}) {
  return {
    requestTimeoutMs: 100,
    retryAttempts: 3,
    retryBaseDelayMs: 0,
    copernicus: {
      apiMode: 'stac',
      stacBaseUrl: 'https://stac.test/v1',
      shCatalogUrl: 'https://sh.test/catalog',
      shProcessUrl: 'https://sh.test/process',
      shStatisticsUrl: 'https://sh.test/statistics',
      tokenUrl: 'https://identity.test/token',
      accessToken: '',
      credentialSets: [{ label: 'primary', clientId: 'id-1', clientSecret: 'secret-1' }],
      ...overrides
    }
  };
}

test('builds the Copernicus statistics request with AOI, interval, and cloud filter', () => {
  const adapter = new CopernicusAdapter({ config: config(), client: {} });
  const external = adapter.buildSentinelHubStatisticsRequest(normalizeRequest(observationPayload()));
  assert.equal(external.url, 'https://sh.test/statistics');
  assert.deepEqual(external.body.input.bounds.bbox, [22, 38, 22.1, 38.1]);
  assert.equal(external.body.input.data[0].dataFilter.maxCloudCoverage, 30);
  assert.equal(external.body.aggregation.timeRange.from, '2026-01-01T00:00:00Z');
  assert.match(external.body.aggregation.evalscript, /B01.*B08/);
});

test('follows STAC pagination and merges provenance items', async () => {
  const requests = [];
  const client = {
    async request(request) {
      requests.push(request);
      if (requests.length === 1) {
        return { status: 200, headers: {}, data: { features: [{ id: 'one' }], links: [{ rel: 'next', href: 'https://stac.test/v1/search', method: 'POST', body: { token: 'next' } }] } };
      }
      return { status: 200, headers: {}, data: { features: [{ id: 'two' }], links: [] } };
    }
  };
  const adapter = new CopernicusAdapter({ config: config(), client, sleep: async () => {} });
  const response = await adapter.fetchStacPages({ method: 'POST', url: 'https://stac.test/v1/search', body: { collections: ['sentinel-2-l2a'] } });
  assert.deepEqual(response.data.features.map((item) => item.id), ['one', 'two']);
  assert.deepEqual(requests[1].data, { token: 'next' });
});

test('authentication falls back to the next credential and caches the token', async () => {
  const bodies = [];
  const client = {
    async post(_url, body) {
      bodies.push(body);
      return bodies.length === 1
        ? { status: 401, data: {} }
        : { status: 200, data: { access_token: 'backup-token', expires_in: 600 } };
    }
  };
  const auth = new CopernicusAuth({
    config: config({ credentialSets: [
      { label: 'primary', clientId: 'id-1', clientSecret: 'secret-1' },
      { label: 'backup', clientId: 'id-2', clientSecret: 'secret-2' }
    ] }).copernicus,
    client,
    now: () => 1000
  });
  assert.equal(await auth.getAccessToken(), 'backup-token');
  assert.equal(await auth.getAccessToken(), 'backup-token');
  assert.equal(bodies.length, 2);
  assert.match(bodies[1], /client_id=id-2/);
});

test('refreshes an expired token after a 401 response', async () => {
  const issued = ['old-token', 'fresh-token'];
  const apiTokens = [];
  const client = {
    async post() { return { status: 200, data: { access_token: issued.shift(), expires_in: 600 } }; },
    async request(request) {
      apiTokens.push(request.headers.Authorization);
      return apiTokens.length === 1
        ? { status: 401, data: {}, headers: {} }
        : { status: 200, data: { data: [] }, headers: { 'content-type': 'application/json' } };
    }
  };
  const adapter = new CopernicusAdapter({ config: config(), client, sleep: async () => {} });
  const response = await adapter.postAuthenticated({ method: 'POST', url: 'https://sh.test/statistics', body: {} }, 'json');
  assert.equal(response.status, 200);
  assert.deepEqual(apiTokens, ['Bearer old-token', 'Bearer fresh-token']);
});

test('marks exhausted transient Copernicus failures as retryable', async () => {
  const client = {
    async request() { return { status: 503, data: { message: 'busy' }, headers: {} }; }
  };
  const adapter = new CopernicusAdapter({ config: config({ accessToken: 'static-token' }), client, sleep: async () => {} });
  await assert.rejects(
    adapter.postAuthenticated({ method: 'POST', url: 'https://sh.test/statistics', body: {} }, 'json'),
    (error) => error.code === 'EXTERNAL_API_ERROR' && error.retryable === true && error.details.externalStatus === 503
  );
});



test('tries every configured credential before consuming a retry', async () => {
  const credentials = Array.from({ length: 5 }, (_, index) => ({
    label: `credential-${index}`,
    clientId: `id-${index}`,
    clientSecret: `secret-${index}`
  }));
  let tokenNumber = 0;
  const apiTokens = [];
  const client = {
    async post() {
      const token = `token-${tokenNumber}`;
      tokenNumber += 1;
      return { status: 200, data: { access_token: token, expires_in: 600 } };
    },
    async request(request) {
      apiTokens.push(request.headers.Authorization);
      return apiTokens.length < credentials.length
        ? { status: 403, data: {}, headers: {} }
        : { status: 200, data: { data: [] }, headers: {} };
    }
  };
  const adapter = new CopernicusAdapter({ config: config({ credentialSets: credentials }), client, sleep: async () => {} });
  const response = await adapter.postAuthenticated({ method: 'POST', url: 'https://sh.test/statistics', body: {} }, 'json');
  assert.equal(response.status, 200);
  assert.deepEqual(apiTokens, credentials.map((_, index) => `Bearer token-${index}`));
});
