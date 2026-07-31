const { createHash } = require('node:crypto');
const AppError = require('../utils/app-error');

const CONTENT_TYPES = Object.freeze({
  'image/png': { extension: 'png', signature: (body) => body.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  'image/jpeg': { extension: 'jpg', signature: (body) => body.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) },
  'image/tiff': {
    extension: 'tif',
    signature: (body) => ['49492a00', '4d4d002a'].includes(body.subarray(0, 4).toString('hex'))
  }
});

const TRANSIENT_KEYS = new Set([
  'requestedAt', 'queriedAt', 'completedAt', 'createdAt', 'updatedAt',
  'acquisition_timestamp', 'persistence'
]);

function sha256(value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return createHash('sha256').update(body).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !TRANSIENT_KEYS.has(key))
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function deriveIdentity(payload, normalizedRequest, explicitKey) {
  const requestForHash = {
    source: normalizedRequest.source,
    mode: normalizedRequest.mode,
    collection: normalizedRequest.collection,
    datasetType: normalizedRequest.datasetType,
    format: normalizedRequest.format,
    responseProfile: normalizedRequest.responseProfile,
    query: normalizedRequest.query,
    options: normalizedRequest.options
  };
  const requestHash = sha256(stableJson(requestForHash));
  const requestedKey = explicitKey || payload.idempotencyKey;
  if (requestedKey !== undefined && (typeof requestedKey !== 'string' || !requestedKey.trim() || requestedKey.length > 200)) {
    throw new AppError('Idempotency key must be a non-empty string of at most 200 characters', 400, 'INVALID_IDEMPOTENCY_KEY');
  }
  return {
    idempotencyKey: requestedKey ? requestedKey.trim() : `req_${requestHash.slice(0, 32)}`,
    requestHash
  };
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value) {
    throw new AppError('Persistable object content must be a non-empty decoded or base64 value', 502, 'INVALID_OBJECT');
  }
  if (value.startsWith('data:')) {
    throw new AppError('Malformed data URLs are not accepted as persistable objects', 502, 'INVALID_OBJECT');
  }
  const compact = value;
  if (/\s/.test(compact) || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new AppError('Object base64 content is malformed or was not encoded correctly', 502, 'INVALID_OBJECT');
  }
  const buffer = Buffer.from(compact, 'base64');
  if (buffer.toString('base64').replace(/=+$/, '') !== compact.replace(/=+$/, '')) {
    throw new AppError('Object base64 content is malformed', 502, 'INVALID_OBJECT');
  }
  return buffer;
}

function validateObject(object) {
  if (!object || typeof object !== 'object' || !Buffer.isBuffer(object.buffer) || object.buffer.length === 0) {
    throw new AppError('Persistable objects require non-empty byte content', 502, 'INVALID_OBJECT');
  }
  const definition = CONTENT_TYPES[object.contentType];
  if (!definition) throw new AppError(`Unsupported object content type: ${object.contentType}`, 502, 'INVALID_OBJECT');
  const prefix = object.buffer.subarray(0, 32).toString('utf8').trim().toLowerCase();
  if (prefix.startsWith('{') || prefix.startsWith('[') || prefix.startsWith('<!doctype') || prefix.startsWith('<html')) {
    throw new AppError('Provider JSON or HTML errors cannot be persisted as images', 502, 'INVALID_OBJECT');
  }
  if (!definition.signature(object.buffer)) {
    throw new AppError(`Object bytes do not match ${object.contentType}`, 502, 'INVALID_OBJECT');
  }
  return { ...object, extension: definition.extension };
}

function extractObjects(result) {
  const normalizedResult = structuredClone(result);
  const objects = [];
  if (normalizedResult.data && Object.hasOwn(normalizedResult.data, 'dataBase64')) {
    const contentType = normalizedResult.data.contentType || normalizedResult.metadata.contentType;
    objects.push(validateObject({
      role: 'scene',
      sourceField: 'data.dataBase64',
      contentType,
      buffer: decodeBase64(normalizedResult.data.dataBase64),
      metadata: {
        originalSceneId: normalizedResult.data.scene_id || '',
        originalFormat: normalizedResult.data.format || ''
      }
    }));
    delete normalizedResult.data.dataBase64;
  }
  return { normalizedResult, objects };
}

function compareEntries(previous, current, changedAt) {
  const previousEntries = comparableEntries(previous);
  const currentEntries = comparableEntries(current);
  const paths = [...new Set([...Object.keys(previousEntries), ...Object.keys(currentEntries)])].sort();
  return paths.map((path, index) => {
    const previousHash = previousEntries[path] === undefined ? null : sha256(stableJson(previousEntries[path]));
    const currentHash = currentEntries[path] === undefined ? null : sha256(stableJson(currentEntries[path]));
    let operation = 'unchanged';
    if (previousHash === null) operation = 'created';
    else if (currentHash === null) operation = 'removed';
    else if (previousHash !== currentHash) operation = 'updated';
    return {
      entryId: `entry_${index}_${sha256(path).slice(0, 12)}`,
      operation,
      path,
      previousHash,
      currentHash,
      changedAt
    };
  });
}

function comparableEntries(result) {
  if (!result) return {};
  const entries = {};
  if (result.data !== undefined) entries['/data'] = stableValue(result.data);
  if (result.metadata !== undefined) entries['/metadata'] = stableValue(result.metadata);
  return entries;
}

function safeKeyToken(value) {
  const token = String(value).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return token || `key-${sha256(value).slice(0, 16)}`;
}

module.exports = {
  compareEntries,
  decodeBase64,
  deriveIdentity,
  extractObjects,
  safeKeyToken,
  sha256,
  stableJson,
  stableValue,
  validateObject
};
