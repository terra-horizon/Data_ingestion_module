const { S3Client } = require('@aws-sdk/client-s3');
const env = require('../config/env');
const AppError = require('../utils/app-error');

let client;

function getS3Client() {
  if (!env.s3.endpoint || !env.s3.region || !env.s3.accessKey || !env.s3.secretKey || !env.s3.bucket) {
    throw new AppError('S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET are required for ingestion persistence', 503, 'S3_CONFIG_MISSING');
  }

  if (!client) {
    client = new S3Client({
      endpoint: env.s3.endpoint,
      region: env.s3.region,
      forcePathStyle: env.s3.forcePathStyle,
      credentials: {
        accessKeyId: env.s3.accessKey,
        secretAccessKey: env.s3.secretKey
      }
    });
  }

  return client;
}

module.exports = {
  getS3Client
};
