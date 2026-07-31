const Minio = require('minio');
const ObjectStorePort = require('../../ports/object-store.port');

class MinioObjectStore extends ObjectStorePort {
  constructor(config, client = null) {
    super();
    this.config = config;
    this.client = client || new Minio.Client({
      endPoint: config.endpoint,
      port: config.port,
      useSSL: config.useSsl,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: config.region
    });
    this.bucketPromise = null;
  }

  async initialize() {
    if (!this.bucketPromise) {
      this.bucketPromise = this.ensureBucket().catch((error) => {
        this.bucketPromise = null;
        throw error;
      });
    }
    return this.bucketPromise;
  }

  async ensureBucket() {
    const exists = await this.client.bucketExists(this.config.bucket);
    if (!exists) await this.client.makeBucket(this.config.bucket, this.config.region);
  }

  async putObject({ bucket = this.config.bucket, key, body, contentType, metadata = {} }) {
    await this.initialize();
    const buffer = Buffer.from(body);
    const safeMetadata = Object.fromEntries(
      Object.entries(metadata)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([name, value]) => [String(name).toLowerCase(), String(value)])
    );
    const etag = await this.client.putObject(bucket, key, buffer, buffer.length, {
      'Content-Type': contentType,
      ...safeMetadata
    });
    return { bucket, key, etag: etag.etag || etag, size: buffer.length, contentType, metadata: safeMetadata };
  }

  async statObject({ bucket = this.config.bucket, key }) {
    await this.initialize();
    try {
      const stat = await this.client.statObject(bucket, key);
      return {
        bucket,
        key,
        etag: stat.etag || null,
        size: stat.size,
        contentType: stat.metaData && (stat.metaData['content-type'] || stat.metaData['Content-Type']) || null,
        metadata: stat.metaData || {}
      };
    } catch (error) {
      if (['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(error.code) || error.statusCode === 404) return null;
      throw error;
    }
  }

  async getObject({ bucket = this.config.bucket, key }) {
    await this.initialize();
    const stream = await this.client.getObject(bucket, key);
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async deleteObject({ bucket = this.config.bucket, key }) {
    await this.initialize();
    await this.client.removeObject(bucket, key);
    return true;
  }
}

module.exports = MinioObjectStore;
