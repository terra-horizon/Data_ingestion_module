const { MongoClient, ObjectId } = require('mongodb');
const IngestionStorePort = require('../../ports/ingestion-store.port');

class MongoDbIngestionStore extends IngestionStorePort {
  constructor(config, client = null) {
    super();
    this.config = config;
    this.client = client || new MongoClient(config.uri);
    this.ownsClient = !client;
    this.collection = null;
    this.initializePromise = null;
  }

  async initialize() {
    if (!this.initializePromise) {
      this.initializePromise = this.connect().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }
    return this.initializePromise;
  }

  async connect() {
    if (this.ownsClient) await this.client.connect();
    this.collection = this.client.db(this.config.dbName).collection(this.config.collection);
    await this.collection.createIndex({ idempotencyKey: 1 }, { unique: true, name: 'unique_idempotency_key' });
    await this.collection.createIndex({ requestHash: 1 }, { name: 'request_hash' });
    await this.collection.createIndex({ ingestionRunId: 1 }, { unique: true, sparse: true, name: 'ingestion_run_id' });
  }

  async upsertIngestionResult(payload) {
    await this.initialize();
    const { createdAt, ...mutable } = payload;
    try {
      return await this.collection.findOneAndUpdate(
        { idempotencyKey: payload.idempotencyKey },
        {
          $setOnInsert: { createdAt },
          $set: mutable
        },
        { upsert: true, returnDocument: 'after', includeResultMetadata: false }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      return this.collection.findOneAndUpdate(
        { idempotencyKey: payload.idempotencyKey },
        { $set: mutable },
        { returnDocument: 'after', includeResultMetadata: false }
      );
    }
  }

  async findByIdempotencyKey(idempotencyKey) {
    await this.initialize();
    return this.collection.findOne({ idempotencyKey });
  }

  async findByRequestHash(requestHash) {
    await this.initialize();
    return this.collection.findOne({ requestHash });
  }

  async getIngestionResult(id) {
    await this.initialize();
    const filters = [{ ingestionRunId: id }, { idempotencyKey: id }];
    if (ObjectId.isValid(id)) filters.unshift({ _id: new ObjectId(id) });
    return this.collection.findOne({ $or: filters });
  }

  async findByIngestionRunId(ingestionRunId) {
    await this.initialize();
    return this.collection.findOne({ ingestionRunId });
  }

  async close() {
    if (this.ownsClient) await this.client.close();
  }
}

module.exports = MongoDbIngestionStore;
