const test = require('node:test');
const assert = require('node:assert/strict');
const Sentinel2ObservationWrapper = require('../src/wrappers/sentinel2-observation.wrapper');
const { getWrapper } = require('../src/wrappers/wrapper.registry');
const { normalizeRequest } = require('../src/handlers/request-normalizer');
const { observationPayload } = require('../test-support/helpers');

function context(overrides = {}) {
  const normalized = normalizeRequest(observationPayload(overrides));
  return { ...normalized, externalRequest: { url: 'https://sh.test/statistics' } };
}

function interval(date, means, sampleCount = 100, noDataCount = 5) {
  const bands = {};
  means.forEach((mean, index) => {
    bands[`B${index}`] = { stats: { mean, sampleCount, noDataCount } };
  });
  return {
    interval: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` },
    outputs: { data: { bands } }
  };
}

const metadata = {
  source: 'copernicus',
  mode: 'sentinel-hub-statistics',
  collection: 'sentinel-2-l2a',
  queriedAt: '2026-01-03T10:00:00Z'
};

test('registry selects the Sentinel-2 observation wrapper', () => {
  assert.equal(getWrapper(context()).constructor.name, 'Sentinel2ObservationWrapper');
});

test('normalizes statistical bands into downstream-compatible observations', () => {
  const wrapper = new Sentinel2ObservationWrapper();
  const result = wrapper.transform(
    { data: [interval('2026-01-01', [0.1, 0.2, 0.3, 0.4, 0.5])] },
    metadata,
    context()
  );
  const [first, second] = result.data.observations;
  assert.equal(first.ingestion_run_id, 'run-123');
  assert.equal(first.aoi_id, 'sperchios');
  assert.equal(first.tile_id, 'tile_0');
  assert.equal(first.collection_status, 'collected');
  assert.equal(first.valid_pixels, 95);
  assert.equal(first.water_status, 'unknown');
  assert.equal(first.water_check_status, 'not_performed');
  assert.deepEqual(first.source_item_ids, ['S2_A', 'S2_B']);
  assert.equal(typeof first.CDOM, 'number');
  assert.equal(typeof first.WQI, 'number');
  assert.equal(second.collection_status, 'unavailable');
  assert.ok(['CDOM', 'Chl_a', 'Color', 'Cya', 'DOC', 'Turb', 'WQI'].every((metric) => second[metric] === null));
  assert.ok(JSON.stringify(result).includes('"CDOM":null'));
  assert.equal(result.metadata.validation.valid, true);
  assert.equal(result.metadata.recordCount, 2);
  assert.deepEqual(result.metadata.mongo.collections, []);
  assert.deepEqual(result.metadata.minio.objects, []);
});

test('maps non-finite and malformed source values to JSON null', () => {
  const wrapper = new Sentinel2ObservationWrapper();
  const result = wrapper.transform(
    { data: [interval('2026-01-01', ['NaN', Infinity, null, 0.4, 0.5])] },
    metadata,
    context({ dateTo: '2026-01-01' })
  );
  const observation = result.data.observations[0];
  assert.equal(observation.collection_status, 'unavailable');
  assert.equal(observation.CDOM, null);
  assert.deepEqual(observation.quality_flags, ['missing_metrics']);
  assert.equal(observation.valid_pixels, 95);
  assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity/);
});

test('rejects generated observations that violate the normalized schema', () => {
  const wrapper = new Sentinel2ObservationWrapper();
  const invalidContext = context({ dateTo: '2026-01-01' });
  invalidContext.query.aoiDefinitionHash = '';
  assert.throws(
    () => wrapper.transform({ data: [] }, metadata, invalidContext),
    (error) => error.code === 'SCHEMA_VALIDATION_ERROR' && error.details.validationErrors.length === 1
  );
});



test('rejects invalid Copernicus statistics responses instead of recording false no-data', () => {
  const wrapper = new Sentinel2ObservationWrapper();
  assert.throws(
    () => wrapper.transform({ unexpected: [] }, metadata, context({ dateTo: '2026-01-01' })),
    (error) => error.code === 'INVALID_SOURCE_RESPONSE' && error.retryable === false
  );
});
