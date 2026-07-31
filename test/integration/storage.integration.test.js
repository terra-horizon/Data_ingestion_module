const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const env = require('../../src/config/env');
const MongoDbIngestionStore = require('../../src/adapters/ingestion-store/mongodb-ingestion-store.adapter');
const MinioObjectStore = require('../../src/adapters/object-store/minio-object-store.adapter');

const enabled = process.env.RUN_INTEGRATION_TESTS === 'true';

test('MongoDB and MinIO adapters persist and retrieve idempotently', { skip: !enabled }, async (t) => {
  const suffix = randomUUID();
  const bucket = env.persistence.s3.bucket;
  const key = `test/ingestions/${suffix}/known.png`;
  const body = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const hash = createHash('sha256').update(body).digest('hex');
  const objectStore = new MinioObjectStore(env.persistence.s3);
  const ingestionStore = new MongoDbIngestionStore(env.persistence.mongo);

  t.after(async () => {
    await objectStore.deleteObject({ bucket, key }).catch(() => {});
    await ingestionStore.initialize();
    await ingestionStore.collection.deleteOne({ idempotencyKey: `test-${suffix}` });
    await ingestionStore.close();
  });

  await objectStore.putObject({
    bucket,
    key,
    body,
    contentType: 'image/png',
    metadata: { sha256: hash }
  });
  const stat = await objectStore.statObject({ bucket, key });
  const downloaded = await objectStore.getObject({ bucket, key });
  assert.equal(stat.size, body.length);
  assert.equal(createHash('sha256').update(downloaded).digest('hex'), hash);

  const now = new Date().toISOString();
  const document = {
    idempotencyKey: `test-${suffix}`,
    requestHash: hash,
    provider: 'integration-test',
    mode: 'test',
    responseProfile: 'test',
    requestSummary: {},
    normalizedResult: { data: { version: 1 }, metadata: { terminalStatus: 'success' } },
    objects: [{ bucket, key, size: body.length, sha256: hash }],
    changedEntries: [{ entryId: 'entry-1', operation: 'created', path: '/data', previousHash: null, currentHash: hash, changedAt: now }],
    status: 'success',
    createdAt: now,
    updatedAt: now
  };
  const first = await ingestionStore.upsertIngestionResult(document);
  const second = await ingestionStore.upsertIngestionResult(document);
  assert.equal(String(first._id), String(second._id));
  assert.equal((await ingestionStore.findByIdempotencyKey(document.idempotencyKey)).objects.length, 1);
});
