const {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand
} = require('@aws-sdk/client-s3');
const env = require('../config/env');
const AppError = require('../utils/app-error');
const { getS3Client } = require('./s3Client');

let bucketReady;

async function ensureBucket() {
  if (!bucketReady) {
    bucketReady = ensureBucketExists();
  }

  return bucketReady;
}

async function ensureBucketExists() {
  const client = getS3Client();

  try {
    await client.send(new HeadBucketCommand({ Bucket: env.s3.bucket }));
  } catch (error) {
    const statusCode = error.$metadata ? error.$metadata.httpStatusCode : undefined;
    if (statusCode !== 404 && error.name !== 'NotFound') {
      throw new AppError(`Unable to access S3 bucket: ${error.message}`, 503, 'S3_BUCKET_ACCESS_FAILED', { retryable: true });
    }

    await client.send(new CreateBucketCommand({ Bucket: env.s3.bucket }));
  }
}

async function uploadJson(key, value, options = {}) {
  const body = Buffer.from(JSON.stringify(value, null, 2));
  return uploadBuffer(key, body, 'application/json', { ...options, extension: '.json' });
}

async function uploadBuffer(key, body, contentType, options = {}) {
  await ensureBucket();

  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const normalizedContentType = contentType || 'application/octet-stream';

  if (buffer.length === 0) {
    throw new AppError('S3 upload body is empty', 500, 'S3_UPLOAD_EMPTY_BODY', { retryable: false });
  }

  const metadata = sanitizeMetadata(options.metadata || {});

  try {
    const response = await getS3Client().send(new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      Body: buffer,
      ContentLength: buffer.length,
      ContentType: normalizedContentType,
      ...(Object.keys(metadata).length > 0 ? { Metadata: metadata } : {})
    }));

    const stat = await statObject(key);
    if (Number(stat.sizeBytes) !== buffer.length) {
      await deleteObject(key);
      throw new AppError(`S3 upload verification failed: expected ${buffer.length} bytes, got ${stat.sizeBytes}`, 500, 'S3_UPLOAD_VERIFICATION_FAILED', { retryable: true });
    }

    if (stat.contentType && stat.contentType.split(';')[0].toLowerCase() !== normalizedContentType.split(';')[0].toLowerCase()) {
      await deleteObject(key);
      throw new AppError(`S3 upload verification failed: expected Content-Type ${normalizedContentType}, got ${stat.contentType}`, 500, 'S3_UPLOAD_VERIFICATION_FAILED', { retryable: true });
    }

    return {
      bucket: env.s3.bucket,
      key,
      contentType: stat.contentType || normalizedContentType,
      extension: options.extension || extensionFromKey(key),
      sizeBytes: stat.sizeBytes,
      etag: response.ETag || stat.etag || '',
      ...(options.assetId ? { assetId: options.assetId } : {}),
      ...(options.assetType ? { assetType: options.assetType } : {}),
      ...(options.originalFilename ? { originalFilename: options.originalFilename } : {})
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(`S3 upload failed: ${error.message}`, 500, 'S3_UPLOAD_FAILED', { retryable: true });
  }
}

async function getObject(key) {
  const stat = await statObject(key);

  try {
    const response = await getS3Client().send(new GetObjectCommand({
      Bucket: env.s3.bucket,
      Key: key
    }));

    return {
      ...stat,
      stream: response.Body
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new AppError(`Asset not found in S3: ${key}`, 404, 'ASSET_NOT_FOUND', { retryable: false });
    }

    throw new AppError(`Unable to read S3 asset: ${error.message || error.name || 'UnknownError'}`, 503, 'S3_ASSET_READ_FAILED', { retryable: true });
  }
}

async function statObject(key) {
  let response;

  try {
    response = await getS3Client().send(new HeadObjectCommand({
      Bucket: env.s3.bucket,
      Key: key
    }));
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new AppError(`Asset not found in S3: ${key}`, 404, 'ASSET_NOT_FOUND', { retryable: false });
    }

    throw new AppError(`Unable to stat S3 asset: ${error.message || error.name || 'UnknownError'}`, 503, 'S3_ASSET_STAT_FAILED', { retryable: true });
  }

  return {
    bucket: env.s3.bucket,
    key,
    contentType: response.ContentType || '',
    sizeBytes: response.ContentLength || 0,
    etag: response.ETag || '',
    metadata: response.Metadata || {}
  };
}

async function deleteObject(key) {
  await getS3Client().send(new DeleteObjectCommand({
    Bucket: env.s3.bucket,
    Key: key
  }));
}

async function deleteObjects(objects) {
  for (const object of objects) {
    if (object && object.key) {
      try {
        await deleteObject(object.key);
      } catch (error) {
        // Best-effort cleanup; preserve the original persistence failure.
      }
    }
  }
}

function sanitizeMetadata(metadata) {
  return Object.entries(metadata).reduce((safe, [key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      safe[String(key).toLowerCase().replace(/[^a-z0-9-]/g, '-')] = String(value);
    }

    return safe;
  }, {});
}

function isNotFoundError(error) {
  const statusCode = error && error.$metadata ? error.$metadata.httpStatusCode : undefined;
  return statusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey' || error?.Code === 'NoSuchKey' || error?.code === 'NoSuchKey';
}

function extensionFromKey(key) {
  const match = String(key).match(/(\.[a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

module.exports = {
  uploadJson,
  uploadBuffer,
  getObject,
  statObject,
  deleteObject,
  deleteObjects
};
