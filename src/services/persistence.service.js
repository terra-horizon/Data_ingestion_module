const crypto = require('node:crypto');
const env = require('../config/env');
const AppError = require('../utils/app-error');
const metadataRepository = require('../repositories/ingestionMetadata.repository');
const objectStorage = require('../storage/objectStorage.service');

function assertConfigured() {
  const missing = [];

  if (!env.mongo.uri) missing.push('MONGO_URI');
  if (!env.mongo.database) missing.push('MONGO_DB_NAME');
  if (!env.mongo.metadataCollection) missing.push('MONGO_METADATA_COLLECTION');
  if (!env.s3.endpoint) missing.push('S3_ENDPOINT');
  if (!env.s3.region) missing.push('S3_REGION');
  if (!env.s3.accessKey) missing.push('S3_ACCESS_KEY');
  if (!env.s3.secretKey) missing.push('S3_SECRET_KEY');
  if (!env.s3.bucket) missing.push('S3_BUCKET');
  if (process.env.S3_FORCE_PATH_STYLE === undefined) missing.push('S3_FORCE_PATH_STYLE');

  if (missing.length > 0) {
    throw new AppError(`Persistence configuration is missing required environment variables: ${missing.join(', ')}`, 503, 'PERSISTENCE_CONFIG_MISSING');
  }
}

async function persistResult(payload, ingestionResult, normalizedRequest) {
  const persistenceRequest = normalizePersistenceRequest(payload, ingestionResult, normalizedRequest);
  const requestId = crypto.randomUUID();
  const createdAt = new Date();
  const uploadedObjects = [];

  try {
    const persisted = await persistIngestionResult(requestId, createdAt, persistenceRequest, ingestionResult, uploadedObjects);
    const completedRecord = await metadataRepository.createMetadata({
      requestId,
      useCaseId: persistenceRequest.useCaseId,
      collection: persistenceRequest.collection,
      provider: persistenceRequest.provider,
      source: ingestionResult.source,
      mode: ingestionResult.mode,
      responseProfile: ingestionResult.responseProfile,
      status: 'completed',
      request: persistenceRequest.request,
      storage: persisted.storage,
      providerMetadata: buildProviderMetadata(ingestionResult, persisted.storage.objects),
      resultSummary: summarizeResult(persisted.result),
      error: null
    });

    return {
      result: persisted.result,
      persistence: toPersistenceResponse(completedRecord)
    };
  } catch (error) {
    if (uploadedObjects.length > 0) {
      await objectStorage.deleteObjects(uploadedObjects);
    }

    throw persistenceError(error, error.stage || (error.code && error.code.startsWith('S3_') ? 's3_upload' : 'mongo_insert'));
  }
}

function normalizePersistenceRequest(payload, ingestionResult, normalizedRequest) {
  const requestParams = payload && payload.requestParams && typeof payload.requestParams === 'object'
    ? payload.requestParams
    : extractFlatRequestParams(payload || {});

  return {
    useCaseId: String((payload && payload.useCaseId) || 'unspecified').trim(),
    collection: String((payload && payload.collection) || ingestionResult.collection || 'unknown').trim(),
    provider: String((payload && (payload.provider || payload.source)) || ingestionResult.source || 'unknown').trim().toLowerCase(),
    request: {
      ...requestParams,
      normalized: normalizedRequest ? {
        source: normalizedRequest.source,
        mode: normalizedRequest.mode,
        collection: normalizedRequest.collection,
        responseProfile: normalizedRequest.responseProfile,
        query: normalizedRequest.query
      } : undefined
    }
  };
}

function extractFlatRequestParams(payload) {
  const fields = [
    'bbox',
    'dateFrom',
    'dateTo',
    'date',
    'cloudCoverageMax',
    'maxCloudCoverage',
    'maxCloudPct',
    'limit',
    'maxImages',
    'scene',
    'product',
    'tiles',
    'tileName',
    'tileSize',
    'imageKeys',
    'outputFormat',
    'crs',
    'upsampling',
    'downsampling'
  ];

  return fields.reduce((params, field) => {
    if (payload[field] !== undefined) {
      params[field] = payload[field];
    }

    return params;
  }, {});
}

async function persistIngestionResult(requestId, createdAt, persistenceRequest, ingestionResult, uploadedObjects) {
  const storedResult = cloneJson(ingestionResult);
  const objects = [];

  await extractAndUploadAssets(storedResult.data, { requestId, createdAt, ingestionResult, objects, uploadedObjects });

  const resultKey = buildResultObjectKey({ ingestionId: requestId, createdAt });
  const resultObject = await objectStorage.uploadJson(resultKey, storedResult, {
    metadata: {
      ingestionId: requestId,
      assetType: 'result'
    }
  });
  uploadedObjects.push(resultObject);
  objects.push(resultObject);

  return {
    result: storedResult,
    storage: {
      bucket: resultObject.bucket,
      objects
    }
  };
}

async function extractAndUploadAssets(value, context, path = []) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      await extractAndUploadAssets(value[index], context, path.concat(index));
    }
    return;
  }

  if (hasAssetData(value)) {
    const asset = normalizeAsset(value, {
      ingestionId: context.requestId,
      provider: context.ingestionResult.source,
      responseProfile: context.ingestionResult.responseProfile,
      sourceField: 'dataBase64',
      fallbackContentType: context.ingestionResult.metadata?.contentType,
      path
    });
    const key = buildObjectKey({
      ingestionId: context.requestId,
      assetId: asset.assetId,
      assetType: asset.assetType,
      extension: asset.extension.replace(/^\./, ''),
      createdAt: context.createdAt
    });
    const uploaded = await objectStorage.uploadBuffer(key, asset.buffer, asset.contentType, {
      extension: asset.extension,
      assetId: asset.assetId,
      assetType: asset.assetType,
      originalFilename: asset.originalFilename,
      metadata: {
        ingestionId: context.requestId,
        assetId: asset.assetId,
        assetType: asset.assetType
      }
    });

    context.uploadedObjects.push(uploaded);
    context.objects.push(uploaded);

    delete value.dataBase64;
    delete value.dataUrl;
    delete value.buffer;
    delete value.arrayBuffer;
    value.storage = {
      bucket: uploaded.bucket,
      key: uploaded.key,
      contentType: uploaded.contentType,
      extension: uploaded.extension,
      sizeBytes: uploaded.sizeBytes,
      assetId: uploaded.assetId,
      assetType: uploaded.assetType,
        previewUrl: previewUrlForKey(uploaded.key),
      downloadUrl: downloadUrlForKey(uploaded.key)
    };
  }

  for (const [key, child] of Object.entries(value)) {
    if (key !== 'storage') {
      await extractAndUploadAssets(child, context, path.concat(key));
    }
  }
}

function hasAssetData(value) {
  return typeof value.dataBase64 === 'string'
    || typeof value.dataUrl === 'string'
    || Buffer.isBuffer(value.buffer)
    || value.arrayBuffer instanceof ArrayBuffer
    || ArrayBuffer.isView(value.arrayBuffer);
}

function normalizeAsset(value, context = {}) {
  const source = pickAssetSource(value);
  const declaredContentType = normalizeContentType(value.contentType || source.contentType || context.fallbackContentType || 'application/octet-stream');
  const buffer = decodeAssetBuffer(source.value, source.kind, declaredContentType, context);
  const detectedContentType = detectImageContentType(buffer);

  validateImageBuffer(buffer, declaredContentType, detectedContentType, context);

  const extension = extensionForContentType(declaredContentType);
  const assetType = sanitizeKeyPart(value.imageKey || value.assetType || value.tileName || context.responseProfile || 'asset');
  const assetId = `ast_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

  return {
    assetId,
    assetType,
    contentType: declaredContentType,
    extension,
    buffer,
    originalFilename: filenameFromContentDisposition(value.contentDisposition) || null
  };
}

function pickAssetSource(value) {
  if (Buffer.isBuffer(value)) {
    return { value, kind: 'buffer' };
  }

  if (Buffer.isBuffer(value.buffer)) {
    return { value: value.buffer, kind: 'buffer' };
  }

  if (value.arrayBuffer instanceof ArrayBuffer || ArrayBuffer.isView(value.arrayBuffer)) {
    return { value: value.arrayBuffer, kind: 'arrayBuffer' };
  }

  if (typeof value.dataUrl === 'string') {
    return parseDataUrl(value.dataUrl);
  }

  if (typeof value.dataBase64 === 'string') {
    return { value: value.dataBase64, kind: 'base64' };
  }

  throw new AppError('Unsupported image asset representation', 500, 'UNSUPPORTED_ASSET_REPRESENTATION', { retryable: false });
}

function decodeAssetBuffer(value, kind, declaredContentType, context) {
  if (kind === 'buffer') {
    return value;
  }

  if (kind === 'arrayBuffer') {
    if (ArrayBuffer.isView(value)) {
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    }

    return Buffer.from(value);
  }

  if (kind === 'dataUrl') {
    return decodeBase64(value, context);
  }

  if (kind === 'base64') {
    return decodeBase64(value, context);
  }

  throw new AppError(`Unsupported image asset value type: ${kind}`, 500, 'UNSUPPORTED_ASSET_REPRESENTATION', { retryable: false });
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) {
    throw new AppError('Malformed image data URL', 500, 'MALFORMED_DATA_URL', { retryable: false });
  }

  return {
    value: match[2],
    kind: 'dataUrl',
    contentType: match[1]
  };
}

function decodeBase64(value, context) {
  const compact = String(value || '').trim();
  if (!compact || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw assetError('Image asset contains malformed or empty base64 data', 'MALFORMED_BASE64_ASSET', context);
  }

  const buffer = Buffer.from(compact, 'base64');
  if (buffer.length === 0) {
    throw assetError('Image asset contains no binary data', 'EMPTY_IMAGE_ASSET', context);
  }

  return buffer;
}

function validateImageBuffer(buffer, declaredContentType, detectedContentType, context) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw assetError('Image asset contains no binary data', 'EMPTY_IMAGE_ASSET', context);
  }

  if (!declaredContentType.startsWith('image/') && declaredContentType !== 'application/geotiff') {
    throw assetError(`Unsupported image content type: ${declaredContentType}`, 'UNSUPPORTED_IMAGE_CONTENT_TYPE', context);
  }

  if (!detectedContentType) {
    throw assetError(`Image signature does not match supported formats for ${declaredContentType}`, 'INVALID_IMAGE_SIGNATURE', context);
  }

  const expectedExtension = extensionForContentType(declaredContentType);
  const detectedExtension = extensionForContentType(detectedContentType);
  if (expectedExtension !== detectedExtension) {
    throw assetError(`Image content type mismatch: declared ${declaredContentType}, detected ${detectedContentType}`, 'IMAGE_CONTENT_TYPE_MISMATCH', context);
  }
}

function detectImageContentType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (buffer.length >= 4
    && ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00)
      || (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))) {
    return 'image/tiff';
  }

  return '';
}

function buildObjectKey({ ingestionId, assetId, assetType, extension, createdAt }) {
  const year = String(createdAt.getUTCFullYear());
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(createdAt.getUTCDate()).padStart(2, '0');
  const safeExtension = String(extension || 'bin').replace(/^\./, '') || 'bin';

  return [
    'ingestions',
    year,
    month,
    day,
    sanitizeKeyPart(ingestionId),
    'assets',
    `${sanitizeKeyPart(assetType)}-${sanitizeKeyPart(assetId)}.${safeExtension}`
  ].join('/');
}

function buildResultObjectKey({ ingestionId, createdAt }) {
  const year = String(createdAt.getUTCFullYear());
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(createdAt.getUTCDate()).padStart(2, '0');

  return ['ingestions', year, month, day, sanitizeKeyPart(ingestionId), 'result.json'].join('/');
}

function extensionForContentType(contentType) {
  const normalized = normalizeContentType(contentType);
  const mappings = new Map([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/tiff', '.tif'],
    ['image/geotiff', '.tif'],
    ['application/geotiff', '.tif'],
    ['application/json', '.json'],
    ['application/geo+json', '.geojson'],
    ['application/zip', '.zip'],
    ['application/octet-stream', '.bin'],
    ['text/plain', '.txt']
  ]);

  return mappings.get(normalized) || '.bin';
}

function normalizeContentType(contentType) {
  return String(contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
}

function filenameFromContentDisposition(contentDisposition) {
  if (!contentDisposition) {
    return null;
  }

  const header = String(contentDisposition);
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  const normalMatch = header.match(/filename="?([^";]+)"?/i);
  const rawFilename = utf8Match ? decodeURIComponent(utf8Match[1]) : normalMatch ? normalMatch[1] : '';

  if (!rawFilename) {
    return null;
  }

  return sanitizeFilename(rawFilename);
}

function sanitizeFilename(value) {
  const filename = String(value || 'file')
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return filename || 'file';
}

function sanitizeKeyPart(value) {
  const sanitized = String(value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[\\/]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^\.+|\.+$/g, '');

  return sanitized || 'unknown';
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function summarizeResult(ingestionResult) {
  const data = ingestionResult.data;

  return {
    source: ingestionResult.source,
    mode: ingestionResult.mode,
    collection: ingestionResult.collection,
    responseProfile: ingestionResult.responseProfile,
    itemCount: Array.isArray(data) ? data.length : data ? 1 : 0
  };
}

function buildProviderMetadata(ingestionResult, objects) {
  return {
    contentType: ingestionResult.metadata?.contentType || null,
    source: ingestionResult.source,
    mode: ingestionResult.mode,
    responseProfile: ingestionResult.responseProfile,
    objects: objects.map((object) => ({
      key: object.key,
      contentType: object.contentType,
      extension: object.extension,
      sizeBytes: object.sizeBytes,
        ...(isPreviewObject(object) ? { previewUrl: previewUrlForKey(object.key), downloadUrl: downloadUrlForKey(object.key) } : {})
    })),
    raw: ingestionResult.metadata || {}
  };
}

function toPersistenceResponse(record) {
  return {
    requestId: record.requestId,
    status: record.status,
    metadataId: String(record._id),
    storage: {
      ...record.storage,
      objects: (record.storage.objects || []).map((object) => ({
        ...object,
        ...(isPreviewObject(object) ? { previewUrl: previewUrlForKey(object.key), downloadUrl: downloadUrlForKey(object.key) } : {})
      }))
    },
    error: record.error || null
  };
}


function isPreviewObject(object) {
  const contentType = normalizeContentType(object.contentType);
  return ['image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/geotiff', 'application/geotiff'].includes(contentType)
    || ['.png', '.jpg', '.jpeg', '.tif', '.tiff'].includes(String(object.extension || '').toLowerCase());
}

function previewUrlForKey(key) {
  return `/api/ingestion/assets?key=${encodeURIComponent(key)}`;
}

function downloadUrlForKey(key) {
  return `${previewUrlForKey(key)}&download=true`;
}
function assetError(message, code, context = {}) {
  return new AppError(message, 500, code, {
    retryable: false,
    provider: context.provider
  });
}

function persistenceError(error, stage) {
  return new AppError(`Ingestion persistence failed during ${stage}: ${error.message}`, error.statusCode || 500, error.code || 'INGESTION_PERSISTENCE_FAILED', {
    retryable: error.retryable !== undefined ? error.retryable : true
  });
}

module.exports = {
  assertConfigured,
  persistResult,
  normalizeAsset,
  buildObjectKey,
  extensionForContentType,
  filenameFromContentDisposition,
  sanitizeFilename
};












