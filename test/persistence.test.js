const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRequest } = require('../src/handlers/request-normalizer');
const { runIngestion } = require('../src/services/ingestion.service');
const IngestionPersistenceService = require('../src/services/ingestion-persistence.service');
const InMemoryIngestionStore = require('../src/adapters/ingestion-store/in-memory-ingestion-store.fake');
const InMemoryObjectStore = require('../src/adapters/object-store/in-memory-object-store.fake');
const { decodeBase64, validateObject } = require('../src/services/persistence-utils');
const { observationPayload } = require('../test-support/helpers');

const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const JPEG = Buffer.from('ffd8ff000000', 'hex');
const TIFF_LE = Buffer.from('49492a0000000000', 'hex');

function result(data = { observations: [{ value: 1 }] }) {
  return {
    ingestionRunId: 'run-123',
    source: 'copernicus',
    mode: 'sentinel-hub-statistics',
    collection: 'sentinel-2-l2a',
    responseProfile: 'sentinel-2-observations',
    data,
    metadata: {
      terminalStatus: 'success',
      provider: 'copernicus',
      completedAt: '2026-07-31T10:00:00.000Z'
    }
  };
}

function fixture() {
  const ingestionStore = new InMemoryIngestionStore();
  const objectStore = new InMemoryObjectStore();
  return {
    ingestionStore,
    objectStore,
    persistence: new IngestionPersistenceService({
      ingestionStore,
      objectStore,
      bucket: 'terra-bucket'
    })
  };
}

async function persist(service, currentResult, key = 'request-123') {
  const payload = observationPayload();
  return service.persist({
    payload,
    normalizedRequest: normalizeRequest(payload),
    result: currentResult,
    explicitIdempotencyKey: key
  });
}

test('validates PNG, JPEG and TIFF signatures', () => {
  for (const [contentType, buffer] of [
    ['image/png', PNG],
    ['image/jpeg', JPEG],
    ['image/tiff', TIFF_LE]
  ]) {
    assert.equal(validateObject({ contentType, buffer }).contentType, contentType);
  }
});

test('rejects empty, malformed, undecoded and mismatched image content', () => {
  assert.throws(() => validateObject({ contentType: 'image/png', buffer: Buffer.alloc(0) }), /non-empty/);
  assert.throws(() => validateObject({ contentType: 'image/png', buffer: Buffer.from('{"error":true}') }), /JSON or HTML|do not match/);
  assert.throws(() => validateObject({ contentType: 'image/png', buffer: JPEG }), /do not match/);
  assert.throws(() => decodeBase64('data:image/png;base64,AAAA'), /data URLs/);
  assert.throws(() => decodeBase64('not decoded base64'), /malformed/);
});

test('first persistence inserts and identical retry remains unchanged', async () => {
  const { persistence, ingestionStore } = fixture();
  const first = await persist(persistence, result());
  const second = await persist(persistence, result());

  assert.equal(first.persistence.operation, 'inserted');
  assert.equal(second.persistence.operation, 'unchanged');
  assert.equal(ingestionStore.records.size, 1);
  assert.equal(second.persistence.changedEntryCount, 0);
  assert.ok((await ingestionStore.findByIdempotencyKey('request-123')).changedEntries.every(
    (entry) => entry.operation === 'unchanged'
  ));
});

test('changed normalized data updates the same record and produces change metadata', async () => {
  const { persistence, ingestionStore } = fixture();
  await persist(persistence, result());
  const updated = await persist(persistence, result({ observations: [{ value: 2 }] }));
  const record = await ingestionStore.findByIdempotencyKey('request-123');

  assert.equal(updated.persistence.operation, 'updated');
  assert.equal(ingestionStore.records.size, 1);
  assert.ok(record.changedEntries.some((entry) => entry.path === '/data' && entry.operation === 'updated'));
});

test('valid binary object is uploaded once, referenced, and removed from Mongo payload', async () => {
  const { persistence, objectStore, ingestionStore } = fixture();
  const imageResult = result({
    scene_id: 'scene-1',
    contentType: 'image/png',
    format: 'png',
    dataBase64: PNG.toString('base64')
  });
  imageResult.metadata.contentType = 'image/png';

  const first = await persist(persistence, imageResult);
  const second = await persist(persistence, imageResult);
  const record = await ingestionStore.findByIdempotencyKey('request-123');

  assert.equal(objectStore.objects.size, 1);
  assert.equal(first.persistence.objectCount, 1);
  assert.equal(second.persistence.operation, 'unchanged');
  assert.equal(record.objects.length, 1);
  assert.equal(record.normalizedResult.data.dataBase64, undefined);
  assert.match(record.objects[0].key, /^ingestions\/\d{4}\/\d{2}\/\d{2}\/request-123\/objects\/scene-obj_[a-f0-9]+\.png$/);
  assert.equal(record.objects[0].sha256.length, 64);
});

test('changed object bytes use a different deterministic key without overwriting prior bytes', async () => {
  const { persistence, objectStore, ingestionStore } = fixture();
  const firstImage = result({ contentType: 'image/png', dataBase64: PNG.toString('base64') });
  firstImage.metadata.contentType = 'image/png';
  await persist(persistence, firstImage);

  const changedPng = Buffer.concat([PNG, Buffer.from([1])]);
  const secondImage = result({ contentType: 'image/png', dataBase64: changedPng.toString('base64') });
  secondImage.metadata.contentType = 'image/png';
  const updated = await persist(persistence, secondImage);
  const record = await ingestionStore.findByIdempotencyKey('request-123');

  assert.equal(updated.persistence.operation, 'updated');
  assert.equal(objectStore.objects.size, 2);
  assert.equal(record.objects.length, 1);
  assert.equal(record.objects[0].size, changedPng.length);
});

test('object-store failure prevents Mongo metadata', async () => {
  const { persistence, objectStore, ingestionStore } = fixture();
  objectStore.failPut = new Error('object store unavailable');
  const imageResult = result({ contentType: 'image/png', dataBase64: PNG.toString('base64') });
  imageResult.metadata.contentType = 'image/png';

  await assert.rejects(() => persist(persistence, imageResult), /persistence failed/i);
  assert.equal(ingestionStore.records.size, 0);
});

test('Mongo failure compensates only the newly uploaded object', async () => {
  const { persistence, objectStore, ingestionStore } = fixture();
  ingestionStore.failUpsert = new Error('mongo unavailable');
  const imageResult = result({ contentType: 'image/png', dataBase64: PNG.toString('base64') });
  imageResult.metadata.contentType = 'image/png';

  await assert.rejects(() => persist(persistence, imageResult), /persistence failed/i);
  assert.equal(objectStore.objects.size, 0);
});

test('runIngestion preserves non-persistent flow and enriches persistent flow', async () => {
  const payload = observationPayload();
  const adapter = {
    async fetchData() {
      return { rawData: { ok: true }, externalRequest: {}, metadata: { source: 'copernicus' } };
    },
    extractMetadata(response) { return response.metadata; }
  };
  const wrapper = { transform: () => ({ data: { accepted: true }, metadata: { terminalStatus: 'success' } }) };
  const plain = await runIngestion(payload, { adapter, wrapper });
  assert.equal(plain.persistence, undefined);

  const { persistence } = fixture();
  const persisted = await runIngestion(payload, { adapter, wrapper, persistence, idempotencyKey: 'header-key' });
  assert.equal(persisted.persistence.persisted, true);
  assert.equal(persisted.persistence.idempotencyKey, 'header-key');
});
