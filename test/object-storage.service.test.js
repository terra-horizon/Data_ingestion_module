const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { Readable } = require('node:stream');

function clearSourceCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}src${path.sep}`)) {
      delete require.cache[key];
    }
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) {
    return stream;
  }

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function loadStorageWithFakeClient(calls, objects = new Map()) {
  Object.assign(process.env, {
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'key',
    S3_SECRET_KEY: 'secret',
    S3_BUCKET: 'terra-ingestion',
    S3_FORCE_PATH_STYLE: 'true'
  });

  clearSourceCache();

  const s3ClientPath = require.resolve('../src/storage/s3Client');
  require.cache[s3ClientPath] = {
    id: s3ClientPath,
    filename: s3ClientPath,
    loaded: true,
    exports: {
      getS3Client() {
        return {
          async send(command) {
            calls.push({ name: command.constructor.name, input: command.input });

            if (command.constructor.name === 'PutObjectCommand') {
              objects.set(command.input.Key, {
                body: Buffer.from(command.input.Body),
                contentType: command.input.ContentType,
                metadata: command.input.Metadata || {}
              });
              return { ETag: 'etag-put' };
            }

            if (command.constructor.name === 'GetObjectCommand') {
              const object = objects.get(command.input.Key);
              return { Body: Readable.from(object.body) };
            }

            if (command.constructor.name === 'HeadObjectCommand') {
              const object = objects.get(command.input.Key) || {
                body: command.input.Key.endsWith('.png') ? Buffer.alloc(16) : Buffer.alloc(123),
                contentType: command.input.Key.endsWith('.png') ? 'image/png' : 'application/json',
                metadata: {}
              };
              return {
                ContentLength: object.body.length,
                ContentType: object.contentType,
                ETag: 'etag-head',
                Metadata: object.metadata
              };
            }

            return {};
          }
        };
      }
    }
  };

  return require('../src/storage/objectStorage.service');
}

test('uploadBuffer sends Buffer to S3 and verifies object with HeadObject', async () => {
  const calls = [];
  const objects = new Map();
  const storage = loadStorageWithFakeClient(calls, objects);
  const body = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

  const result = await storage.uploadBuffer('ingestions/2026/07/08/ing/assets/preview-asset.png', body, 'image/png', {
    extension: '.png',
    metadata: {
      ingestionId: 'ing',
      assetId: 'asset',
      assetType: 'preview'
    }
  });

  const put = calls.find((call) => call.name === 'PutObjectCommand');
  const head = calls.find((call) => call.name === 'HeadObjectCommand');

  assert.ok(put);
  assert.ok(head);
  assert.equal(put.input.Bucket, 'terra-ingestion');
  assert.equal(put.input.Key, head.input.Key);
  assert.equal(Buffer.isBuffer(put.input.Body), true);
  assert.equal(put.input.ContentLength, body.length);
  assert.equal(put.input.ContentType, 'image/png');
  assert.equal(put.input.Metadata.ingestionid, 'ing');
  assert.equal(result.contentType, 'image/png');
  assert.equal(result.sizeBytes, body.length);
});

test('getObject reads uploaded object bytes through S3 API after stat lookup', async () => {
  const calls = [];
  const objects = new Map();
  const storage = loadStorageWithFakeClient(calls, objects);
  const body = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const key = 'ingestions/2026/07/08/ing/assets/preview-asset.png';

  await storage.uploadBuffer(key, body, 'image/png', { extension: '.png' });
  const object = await storage.getObject(key);
  const downloaded = await streamToBuffer(object.stream);
  const head = calls.find((call) => call.name === 'HeadObjectCommand');
  const get = calls.find((call) => call.name === 'GetObjectCommand');

  assert.ok(head);
  assert.ok(get);
  assert.equal(head.input.Key, get.input.Key);
  assert.equal(object.contentType, 'image/png');
  assert.equal(downloaded.length, body.length);
  assert.equal(sha256(downloaded), sha256(body));
});

test('getObject maps missing S3 objects to ASSET_NOT_FOUND', async () => {
  const calls = [];
  Object.assign(process.env, {
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'key',
    S3_SECRET_KEY: 'secret',
    S3_BUCKET: 'terra-ingestion',
    S3_FORCE_PATH_STYLE: 'true'
  });

  clearSourceCache();

  const s3ClientPath = require.resolve('../src/storage/s3Client');
  require.cache[s3ClientPath] = {
    id: s3ClientPath,
    filename: s3ClientPath,
    loaded: true,
    exports: {
      getS3Client() {
        return {
          async send(command) {
            calls.push({ name: command.constructor.name, input: command.input });
            const error = new Error('Not found');
            error.name = 'NoSuchKey';
            error.$metadata = { httpStatusCode: 404 };
            throw error;
          }
        };
      }
    }
  };

  const storage = require('../src/storage/objectStorage.service');

  await assert.rejects(
    () => storage.getObject('ingestions/missing/assets/file.tif'),
    (error) => error.code === 'ASSET_NOT_FOUND' && error.statusCode === 404
  );
  assert.equal(calls[0].name, 'HeadObjectCommand');
});
