const { randomUUID } = require('node:crypto');
const IngestionStorePort = require('../../ports/ingestion-store.port');

class InMemoryIngestionStore extends IngestionStorePort {
  constructor() {
    super();
    this.records = new Map();
    this.failUpsert = null;
  }

  async upsertIngestionResult(payload) {
    if (this.failUpsert) throw this.failUpsert;
    const existing = this.records.get(payload.idempotencyKey);
    const record = {
      ...(existing || {}),
      ...structuredClone(payload),
      _id: existing ? existing._id : randomUUID(),
      createdAt: existing ? existing.createdAt : payload.createdAt,
      updatedAt: payload.updatedAt
    };
    this.records.set(payload.idempotencyKey, record);
    return structuredClone(record);
  }

  async findByIdempotencyKey(idempotencyKey) {
    const value = this.records.get(idempotencyKey);
    return value ? structuredClone(value) : null;
  }

  async findByRequestHash(requestHash) {
    const value = [...this.records.values()].find((record) => record.requestHash === requestHash);
    return value ? structuredClone(value) : null;
  }

  async getIngestionResult(id) {
    const value = [...this.records.values()].find((record) => String(record._id) === String(id));
    return value ? structuredClone(value) : null;
  }

  async findByIngestionRunId(ingestionRunId) {
    const value = [...this.records.values()].find((record) => record.ingestionRunId === ingestionRunId);
    return value ? structuredClone(value) : null;
  }
}

module.exports = InMemoryIngestionStore;
