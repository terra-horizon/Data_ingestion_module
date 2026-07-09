const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG_BYTES = Buffer.from('ffd8ffe000104a464946', 'hex');
const TIF_BYTES = Buffer.from('49492a0008000000', 'hex');

function clearSourceCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}src${path.sep}`)) {
      delete require.cache[key];
    }
  }
}

function loadPersistenceWithFakes({ storage, repository, envOverrides = {} } = {}) {
  for (const key of [
    'PERSISTENCE_ENABLED_DEFAULT',
    'MONGO_URI',
    'MONGO_DB_NAME',
    'MONGO_DATABASE',
    'MONGO_METADATA_COLLECTION',
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET',
    'S3_FORCE_PATH_STYLE'
  ]) {
    delete process.env[key];
  }

  Object.assign(process.env, {
    MONGO_URI: 'mongodb://localhost:27017/terra',
    MONGO_DB_NAME: 'terra',
    MONGO_METADATA_COLLECTION: 'ingestion_metadata',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'key',
    S3_SECRET_KEY: 'secret',
    S3_BUCKET: 'terra-ingestion',
    S3_FORCE_PATH_STYLE: 'true',
    ...envOverrides
  });

  clearSourceCache();

  const storagePath = require.resolve('../src/storage/objectStorage.service');
  const repositoryPath = require.resolve('../src/repositories/ingestionMetadata.repository');

  require.cache[storagePath] = {
    id: storagePath,
    filename: storagePath,
    loaded: true,
    exports: storage || {}
  };
  require.cache[repositoryPath] = {
    id: repositoryPath,
    filename: repositoryPath,
    loaded: true,
    exports: repository || {}
  };

  return require('../src/services/persistence.service');
}

test('assertConfigured fails clearly when persistence env is missing', () => {
  const persistence = loadPersistenceWithFakes({ envOverrides: { MONGO_URI: '' } });

  assert.throws(
    () => persistence.assertConfigured(),
    (error) => error.code === 'PERSISTENCE_CONFIG_MISSING' && error.message.includes('MONGO_URI')
  );
});

test('normalizeAsset accepts buffers, base64 strings, data URLs, and typed arrays', () => {
  const persistence = loadPersistenceWithFakes();

  const raw = persistence.normalizeAsset({ imageKey: 'raw', contentType: 'image/png', buffer: PNG_BYTES });
  assert.ok(Buffer.isBuffer(raw.buffer));
  assert.equal(raw.extension, '.png');

  const base64 = persistence.normalizeAsset({ imageKey: 'b64', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64') });
  assert.deepEqual(base64.buffer, PNG_BYTES);

  const dataUrl = persistence.normalizeAsset({ imageKey: 'url', dataUrl: `data:image/png;base64,${PNG_BYTES.toString('base64')}` });
  assert.deepEqual(dataUrl.buffer, PNG_BYTES);

  const typed = persistence.normalizeAsset({ imageKey: 'typed', contentType: 'image/jpeg', arrayBuffer: new Uint8Array(JPG_BYTES) });
  assert.deepEqual(typed.buffer, JPG_BYTES);
  assert.equal(typed.extension, '.jpg');

  const tiff = persistence.normalizeAsset({ imageKey: 'tif', contentType: 'image/tiff', dataBase64: TIF_BYTES.toString('base64') });
  assert.equal(tiff.extension, '.tif');
});

test('normalizeAsset rejects malformed or mismatched image values', () => {
  const persistence = loadPersistenceWithFakes();

  assert.throws(
    () => persistence.normalizeAsset({ imageKey: 'empty', contentType: 'image/png', dataBase64: '' }),
    (error) => error.code === 'MALFORMED_BASE64_ASSET'
  );
  assert.throws(
    () => persistence.normalizeAsset({ imageKey: 'bad', contentType: 'image/png', dataBase64: 'not-base64' }),
    (error) => error.code === 'MALFORMED_BASE64_ASSET'
  );
  assert.throws(
    () => persistence.normalizeAsset({ imageKey: 'json', contentType: 'image/png', dataBase64: Buffer.from('{"error":true}').toString('base64') }),
    (error) => error.code === 'INVALID_IMAGE_SIGNATURE'
  );
  assert.throws(
    () => persistence.normalizeAsset({ imageKey: 'mismatch', contentType: 'image/png', dataBase64: JPG_BYTES.toString('base64') }),
    (error) => error.code === 'IMAGE_CONTENT_TYPE_MISMATCH'
  );
  assert.throws(
    () => persistence.normalizeAsset({ imageKey: 'object', contentType: 'image/png', payload: {} }),
    (error) => error.code === 'UNSUPPORTED_ASSET_REPRESENTATION'
  );
});

test('extensionForContentType maps supported provider content types', () => {
  const persistence = loadPersistenceWithFakes();

  assert.equal(persistence.extensionForContentType('image/png'), '.png');
  assert.equal(persistence.extensionForContentType('image/jpeg'), '.jpg');
  assert.equal(persistence.extensionForContentType('image/jpg'), '.jpg');
  assert.equal(persistence.extensionForContentType('image/tiff'), '.tif');
  assert.equal(persistence.extensionForContentType('image/geotiff'), '.tif');
  assert.equal(persistence.extensionForContentType('application/geotiff'), '.tif');
  assert.equal(persistence.extensionForContentType('application/json'), '.json');
  assert.equal(persistence.extensionForContentType('application/geo+json'), '.geojson');
  assert.equal(persistence.extensionForContentType('application/zip'), '.zip');
  assert.equal(persistence.extensionForContentType('application/octet-stream'), '.bin');
  assert.equal(persistence.extensionForContentType('text/plain'), '.txt');
  assert.equal(persistence.extensionForContentType('application/unknown'), '.bin');
});

test('buildObjectKey uses date hierarchy and safe S3 separators', () => {
  const persistence = loadPersistenceWithFakes();
  const key = persistence.buildObjectKey({
    ingestionId: 'ing_01JZ8WCP',
    assetId: 'ast_72B9',
    assetType: '../preview\\bad',
    extension: 'png',
    createdAt: new Date('2026-07-08T12:00:00Z')
  });

  assert.equal(key, 'ingestions/2026/07/08/ing_01jz8wcp/assets/preview-bad-ast_72b9.png');
  assert.equal(key.startsWith('/'), false);
  assert.equal(key.includes('\\'), false);
  assert.equal(key.includes('..'), false);
});

test('persistResult uploads verified image bytes and saves Mongo metadata without base64', async () => {
  const uploads = [];
  const records = [];
  const id = 'metadata-id';

  const persistence = loadPersistenceWithFakes({
    storage: {
      async uploadBuffer(key, body, contentType, options) {
        uploads.push({ key, body, contentType, options });
        return {
          bucket: 'terra-ingestion',
          key,
          contentType,
          extension: options.extension,
          sizeBytes: body.length,
          etag: 'etag-image',
          assetId: options.assetId,
          assetType: options.assetType
        };
      },
      async uploadJson(key, value) {
        uploads.push({ key, body: Buffer.from(JSON.stringify(value)), contentType: 'application/json', options: { extension: '.json' } });
        return {
          bucket: 'terra-ingestion',
          key,
          contentType: 'application/json',
          extension: '.json',
          sizeBytes: 123,
          etag: 'etag-json'
        };
      },
      async deleteObjects() {}
    },
    repository: {
      async createMetadata(record) {
        records.push(record);
        return { ...record, _id: id };
      }
    }
  });

  const persisted = await persistence.persistResult({
    useCaseId: '1',
    source: 'copernicus',
    collection: 'sentinel-2-l2a',
    requestParams: { date: '2024-01-02' }
  }, {
    source: 'copernicus',
    mode: 'sentinel-hub-process',
    collection: 'sentinel-2-l2a',
    responseProfile: 'target-date-image',
    data: [{ imageKey: 'true_color', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }],
    metadata: { contentType: 'image/png' }
  });

  const imageUpload = uploads.find((upload) => upload.contentType === 'image/png');
  assert.ok(imageUpload);
  assert.match(imageUpload.key, /^ingestions\/\d{4}\/\d{2}\/\d{2}\//);
  assert.match(imageUpload.key, /\.png$/);
  assert.doesNotMatch(imageUpload.key, /\.meta$/);
  assert.equal(imageUpload.options.extension, '.png');
  assert.deepEqual(imageUpload.body, PNG_BYTES);
  assert.equal(persisted.result.data[0].dataBase64, undefined);
  assert.equal(persisted.result.data[0].storage.contentType, 'image/png');
  assert.equal(persisted.result.data[0].storage.extension, '.png');
  assert.match(persisted.result.data[0].storage.previewUrl, /^\/api\/ingestion\/assets\?key=/);
  assert.match(persisted.result.data[0].storage.downloadUrl, /^\/api\/ingestion\/assets\?key=.*&download=true$/);
  assert.equal(persisted.persistence.status, 'completed');
  assert.equal(persisted.persistence.metadataId, id);
  assert.match(persisted.persistence.storage.objects[0].previewUrl, /^\/api\/ingestion\/assets\?key=/);
  assert.match(persisted.persistence.storage.objects[0].downloadUrl, /^\/api\/ingestion\/assets\?key=.*&download=true$/);
  assert.equal(records.length, 1);
  assert.equal(JSON.stringify(records[0]).includes(PNG_BYTES.toString('base64')), false);
});

test('persistResult cleans uploaded objects when MongoDB save fails', async () => {
  const uploaded = [];
  const deleted = [];
  const persistence = loadPersistenceWithFakes({
    storage: {
      async uploadBuffer(key, body, contentType, options) {
        const object = { bucket: 'terra-ingestion', key, contentType, extension: options.extension, sizeBytes: body.length };
        uploaded.push(object);
        return object;
      },
      async uploadJson(key) {
        const object = { bucket: 'terra-ingestion', key, contentType: 'application/json', extension: '.json', sizeBytes: 10 };
        uploaded.push(object);
        return object;
      },
      async deleteObjects(objects) {
        deleted.push(...objects.map((object) => object.key));
      }
    },
    repository: {
      async createMetadata() {
        throw Object.assign(new Error('mongo down'), { code: 'MONGO_SAVE_FAILED' });
      }
    }
  });

  await assert.rejects(
    () => persistence.persistResult({ useCaseId: '1', source: 'copernicus', collection: 'sentinel-2-l2a' }, {
      source: 'copernicus',
      mode: 'sentinel-hub-process',
      collection: 'sentinel-2-l2a',
      responseProfile: 'target-date-image',
      data: [{ imageKey: 'true_color', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }],
      metadata: { contentType: 'image/png' }
    }),
    (error) => error.code === 'MONGO_SAVE_FAILED' && error.message.includes('mongo_insert')
  );

  assert.equal(deleted.length, uploaded.length);
});

test('persistResult cleans current uploads when S3 upload fails', async () => {
  const deleted = [];
  const persistence = loadPersistenceWithFakes({
    storage: {
      async uploadBuffer(key, body, contentType, options) {
        return { bucket: 'terra-ingestion', key, contentType, extension: options.extension, sizeBytes: body.length };
      },
      async uploadJson() {
        throw Object.assign(new Error('upload failed'), { code: 'S3_UPLOAD_FAILED' });
      },
      async deleteObjects(objects) {
        deleted.push(...objects.map((object) => object.key));
      }
    },
    repository: {
      async createMetadata() {
        throw new Error('should not save MongoDB when S3 failed');
      }
    }
  });

  await assert.rejects(
    () => persistence.persistResult({ useCaseId: '1', source: 'copernicus', collection: 'sentinel-2-l2a' }, {
      source: 'copernicus',
      mode: 'sentinel-hub-process',
      collection: 'sentinel-2-l2a',
      responseProfile: 'target-date-image',
      data: [{ imageKey: 'true_color', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }],
      metadata: { contentType: 'image/png' }
    }),
    (error) => error.code === 'S3_UPLOAD_FAILED' && error.message.includes('s3_upload')
  );

  assert.equal(deleted.length, 1);
});


