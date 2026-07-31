const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRequest } = require('../src/handlers/request-normalizer');
const { getSourceAdapter } = require('../src/sources/source.registry');
const { runIngestion } = require('../src/services/ingestion.service');

const { observationPayload } = require('../test-support/helpers');

test('normalizes a Sentinel-2 observation request and preserves idempotency identity', () => {
  const request = normalizeRequest(observationPayload());
  assert.equal(request.source, 'copernicus');
  assert.equal(request.operation.ingestionRunId, 'run-123');
  assert.deepEqual(request.query.sourceItemIds, ['S2_A', 'S2_B']);
  assert.equal(request.query.cloudCoverageMax, 30);
});

test('rejects invalid observation identities and date ranges', () => {
  assert.throws(() => normalizeRequest(observationPayload({ tileId: '' })), /tileId is required/);
  assert.throws(() => normalizeRequest(observationPayload({ dateFrom: '2026-01-03' })), /dateFrom must be on or before dateTo/);
  assert.throws(() => normalizeRequest(observationPayload({ cloudCoverageMax: 101 })), /between 0 and 100/);
});

test('source registry dispatches Copernicus to the Copernicus adapter', () => {
  assert.equal(getSourceAdapter('COPERNICUS').getName(), 'copernicus');
});

test('ingestion service dispatches normalized request through adapter and wrapper', async () => {
  let received;
  const adapter = {
    async fetchData(request) {
      received = request;
      return { rawData: { ok: true }, externalRequest: {}, metadata: { source: 'copernicus' } };
    },
    extractMetadata(response) { return response.metadata; }
  };
  const wrapper = { transform: () => ({ data: { accepted: true }, metadata: { terminalStatus: 'success' } }) };
  const result = await runIngestion(observationPayload(), { adapter, wrapper });
  assert.equal(received.mode, 'sentinel-hub-statistics');
  assert.equal(result.ingestionRunId, 'run-123');
  assert.deepEqual(result.data, { accepted: true });
});

module.exports = { observationPayload };


