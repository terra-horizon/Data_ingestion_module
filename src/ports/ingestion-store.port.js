class IngestionStorePort {
  async upsertIngestionResult() {
    throw new Error('upsertIngestionResult must be implemented');
  }

  async findByIdempotencyKey() {
    throw new Error('findByIdempotencyKey must be implemented');
  }

  async findByRequestHash() {
    throw new Error('findByRequestHash must be implemented');
  }

  async getIngestionResult() {
    throw new Error('getIngestionResult must be implemented');
  }

  async findByIngestionRunId() {
    throw new Error('findByIngestionRunId must be implemented');
  }
}

module.exports = IngestionStorePort;
