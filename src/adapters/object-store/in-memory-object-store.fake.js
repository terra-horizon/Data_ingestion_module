const ObjectStorePort = require('../../ports/object-store.port');

class InMemoryObjectStore extends ObjectStorePort {
  constructor() {
    super();
    this.objects = new Map();
    this.failPut = null;
  }

  async putObject({ bucket, key, body, contentType, metadata = {} }) {
    if (this.failPut) throw this.failPut;
    const buffer = Buffer.from(body);
    const record = {
      bucket,
      key,
      body: buffer,
      contentType,
      metadata: { ...metadata },
      size: buffer.length,
      etag: metadata.sha256 || null
    };
    this.objects.set(this.identity(bucket, key), record);
    return this.withoutBody(record);
  }

  async statObject({ bucket, key }) {
    const value = this.objects.get(this.identity(bucket, key));
    return value ? this.withoutBody(value) : null;
  }

  async getObject({ bucket, key }) {
    const value = this.objects.get(this.identity(bucket, key));
    return value ? Buffer.from(value.body) : null;
  }

  async deleteObject({ bucket, key }) {
    return this.objects.delete(this.identity(bucket, key));
  }

  identity(bucket, key) {
    return `${bucket}/${key}`;
  }

  withoutBody({ body, ...metadata }) {
    return { ...metadata };
  }
}

module.exports = InMemoryObjectStore;
