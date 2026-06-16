const test = require('node:test');
const assert = require('node:assert/strict');
const EarthObservationProductRegistry = require('../src/services/copernicus/earth-observation-product-registry');
const SentinelHubProcessAdapter = require('../src/services/copernicus/sentinel-hub-process.adapter');

test('EarthObservationProductRegistry exposes supported products and rejects unknown keys', () => {
  const registry = new EarthObservationProductRegistry();

  assert.ok(registry.keys().includes('true_color'));
  assert.ok(registry.keys().includes('surface_temperature'));
  assert.throws(() => registry.get('unknown_product'), /Unsupported image product/);
});

test('SentinelHubProcessAdapter builds Process API payload', () => {
  const registry = new EarthObservationProductRegistry();
  const adapter = new SentinelHubProcessAdapter({
    productRegistry: registry,
    authService: { getAccessToken: async () => 'token' },
    httpClient: { post: async () => ({ status: 200, data: Buffer.from('image') }) }
  });
  const product = registry.get('true_color');
  const payload = adapter.buildPayload(product, {
    bbox: [22.1, 39.4, 22.2, 39.5],
    date: '2026-05-27',
    tileSize: 400,
    outputFormat: 'image/png'
  });

  assert.equal(payload.input.data[0].type, 'sentinel-2-l2a');
  assert.equal(payload.output.width, 400);
  assert.equal(payload.output.responses[0].format.type, 'image/png');
});

test('SentinelHubProcessAdapter returns empty image response as provider error', async () => {
  const adapter = new SentinelHubProcessAdapter({
    authService: { getAccessToken: async () => 'token', clearCurrentToken: () => {}, rotateCredential: () => false },
    httpClient: {
      post: async () => ({ status: 200, data: Buffer.alloc(0), headers: { 'content-type': 'image/png' } })
    },
    maxRetries: 1
  });

  await assert.rejects(
    () => adapter.postProcess({}),
    (error) => error.code === 'EMPTY_PROVIDER_RESPONSE'
  );
});
