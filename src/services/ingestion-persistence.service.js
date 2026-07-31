const AppError = require('../utils/app-error');
const {
  compareEntries,
  deriveIdentity,
  extractObjects,
  safeKeyToken,
  sha256,
  stableValue
} = require('./persistence-utils');

class IngestionPersistenceService {
  constructor({ ingestionStore, objectStore, bucket }) {
    this.ingestionStore = ingestionStore;
    this.objectStore = objectStore;
    this.bucket = bucket;
  }

  async persist({ payload, normalizedRequest, result, explicitIdempotencyKey }) {
    this.validateResult(normalizedRequest, result);
    const identity = deriveIdentity(payload, normalizedRequest, explicitIdempotencyKey);
    const existing = await this.ingestionStore.findByIdempotencyKey(identity.idempotencyKey);
    const { normalizedResult, objects } = extractObjects(result);
    const uploadedNow = [];

    try {
      const objectMetadata = await this.persistObjects({
        objects,
        identity,
        normalizedRequest,
        existing,
        uploadedNow
      });
      this.attachObjectReferences(normalizedResult, objectMetadata);
      const timestamp = new Date().toISOString();
      const changedEntries = compareEntries(existing && existing.normalizedResult, normalizedResult, timestamp);
      const hasChanges = changedEntries.some((entry) => entry.operation !== 'unchanged');
      const operation = existing ? (hasChanges ? 'updated' : 'unchanged') : 'inserted';
      const record = await this.ingestionStore.upsertIngestionResult({
        idempotencyKey: identity.idempotencyKey,
        ingestionRunId: normalizedResult.ingestionRunId || normalizedRequest.operation?.ingestionRunId,
        requestHash: identity.requestHash,
        provider: normalizedRequest.source,
        mode: normalizedRequest.mode,
        responseProfile: normalizedRequest.responseProfile,
        requestSummary: stableValue(normalizedRequest),
        normalizedResult,
        objects: deduplicateObjects(objectMetadata),
        changedEntries,
        status: normalizedResult.metadata.terminalStatus || 'success',
        createdAt: existing ? existing.createdAt : timestamp,
        updatedAt: timestamp
      });
      return {
        result: normalizedResult,
        persistence: {
          persisted: true,
          idempotencyKey: identity.idempotencyKey,
          recordId: String(record._id),
          operation,
          objectCount: objectMetadata.length,
          changedEntryCount: changedEntries.filter((entry) => entry.operation !== 'unchanged').length
        }
      };
    } catch (error) {
      await this.cleanup(uploadedNow, error);
      if (error instanceof AppError) throw error;
      throw new AppError('Ingestion persistence failed', 503, 'PERSISTENCE_ERROR', {
        retryable: true,
        details: { cause: error.message }
      });
    }
  }

  validateResult(request, result) {
    for (const [name, value] of Object.entries({
      provider: request.source,
      mode: request.mode,
      responseProfile: request.responseProfile
    })) {
      if (typeof value !== 'string' || !value) {
        throw new AppError(`${name} is required before persistence`, 500, 'INVALID_PERSISTENCE_INPUT');
      }
    }
    if (!result || typeof result !== 'object' || !result.data || !result.metadata || typeof result.metadata !== 'object') {
      throw new AppError('Normalized ingestion result is invalid', 502, 'INVALID_PERSISTENCE_INPUT');
    }
    const status = result.metadata.terminalStatus || 'success';
    if (!['success', 'partial'].includes(status)) {
      throw new AppError(`Ingestion result status ${status} cannot be persisted`, 502, 'INVALID_PERSISTENCE_INPUT');
    }
  }

  async persistObjects({ objects, identity, normalizedRequest, existing, uploadedNow }) {
    const existingByHash = new Map((existing && existing.objects || []).map((object) => [object.sha256, object]));
    const metadata = [];
    for (const object of objects) {
      const hash = sha256(object.buffer);
      const reusable = existingByHash.get(hash);
      if (reusable && reusable.size === object.buffer.length && reusable.contentType === object.contentType) {
        metadata.push(reusable);
        continue;
      }
      const objectId = `obj_${hash.slice(0, 24)}`;
      let key = this.objectKey(normalizedRequest.operation.requestedAt, identity.idempotencyKey, object, objectId);
      let stat = await this.objectStore.statObject({ bucket: this.bucket, key });
      if (stat && !sameObject(stat, hash, object)) {
        key = key.replace(`.${object.extension}`, `-${hash.slice(0, 12)}.${object.extension}`);
        stat = await this.objectStore.statObject({ bucket: this.bucket, key });
      }
      let stored = stat;
      if (!sameObject(stat, hash, object)) {
        stored = await this.objectStore.putObject({
          bucket: this.bucket,
          key,
          body: object.buffer,
          contentType: object.contentType,
          metadata: { sha256: hash, objectid: objectId, role: object.role }
        });
        uploadedNow.push({ bucket: this.bucket, key });
      }
      metadata.push({
        objectId,
        bucket: this.bucket,
        key,
        contentType: object.contentType,
        size: object.buffer.length,
        etag: stored.etag || null,
        sha256: hash,
        role: object.role,
        sourceField: object.sourceField,
        createdAt: new Date().toISOString()
      });
    }
    return metadata;
  }

  objectKey(requestedAt, idempotencyKey, object, objectId) {
    const date = new Date(requestedAt);
    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return [
      'ingestions', year, month, day, safeKeyToken(idempotencyKey), 'objects',
      `${safeKeyToken(object.role)}-${objectId}.${object.extension}`
    ].join('/');
  }

  attachObjectReferences(result, objects) {
    if (!objects.length) return;
    result.data.objects = objects.map(({ objectId, bucket, key, contentType, size, etag, sha256, role }) => ({
      objectId, bucket, key, contentType, size, etag, sha256, role
    }));
  }

  async cleanup(objects, originalError) {
    for (const object of objects) {
      try {
        await this.objectStore.deleteObject(object);
      } catch (cleanupError) {
        originalError.cleanupErrors = [...(originalError.cleanupErrors || []), cleanupError.message];
      }
    }
  }
}

function sameObject(stat, hash, object) {
  if (!stat) return false;
  const metadata = stat.metadata || {};
  const storedHash = metadata.sha256 || metadata['x-amz-meta-sha256'];
  return stat.size === object.buffer.length && storedHash === hash;
}

function deduplicateObjects(objects) {
  return [...new Map(objects.map((object) => [`${object.bucket}/${object.key}`, object])).values()];
}

module.exports = IngestionPersistenceService;
