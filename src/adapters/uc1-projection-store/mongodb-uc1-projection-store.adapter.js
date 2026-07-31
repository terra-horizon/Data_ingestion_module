const { MongoClient } = require('mongodb');
const Uc1ProjectionStorePort = require('../../ports/uc1-projection-store.port');
const { stableJson } = require('../../services/persistence-utils');

class MongoDbUc1ProjectionStore extends Uc1ProjectionStorePort {
  constructor(config, client = null) {
    super();
    this.config = config;
    this.client = client || new MongoClient(config.uri);
    this.ownsClient = !client;
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
    const database = this.client.db(this.config.dbName);
    this.tiles = database.collection(this.config.tilesCollection);
    this.observations = database.collection(this.config.observationsCollection);
    await Promise.all([
      this.tiles.createIndex({ aoiId: 1, tileId: 1 }, { unique: true, name: 'unique_aoi_tile' }),
      this.tiles.createIndex({ aoiId: 1 }, { name: 'aoi' }),
      this.tiles.createIndex({ aoiDefinitionHash: 1 }, { name: 'aoi_definition' }),
      this.observations.createIndex(
        { aoiId: 1, tileId: 1, observationDate: 1, provider: 1, sourceProductId: 1 },
        { unique: true, name: 'unique_uc1_observation' }
      ),
      this.observations.createIndex({ aoiId: 1, observationDate: 1 }, { name: 'aoi_date' }),
      this.observations.createIndex({ tileId: 1, observationDate: 1 }, { name: 'tile_date' }),
      this.observations.createIndex({ ingestionRunId: 1 }, { name: 'ingestion_run' })
    ]);
  }

  async upsertTiles(tiles, ingestionRunId) {
    await this.initialize();
    return this.upsertMany(this.tiles, tiles, ['aoiId', 'tileId'], ingestionRunId);
  }

  async upsertObservations(observations, ingestionRunId) {
    await this.initialize();
    return this.upsertMany(
      this.observations,
      observations,
      ['aoiId', 'tileId', 'observationDate', 'provider', 'sourceProductId'],
      ingestionRunId
    );
  }

  async upsertMany(collection, items, keyFields, ingestionRunId) {
    const counts = { inserted: 0, updated: 0, unchanged: 0 };
    for (const item of items) {
      const filter = Object.fromEntries(keyFields.map((field) => [field, item[field]]));
      const existing = await collection.findOne(filter);
      const payload = { ...item, lastIngestionRunId: ingestionRunId };
      if (existing) payload.createdAt = existing.createdAt;
      const previousComparable = existing ? withoutMongoId({ ...existing, updatedAt: payload.updatedAt, lastIngestionRunId: ingestionRunId }) : null;
      if (!existing) counts.inserted += 1;
      else if (stableJson(previousComparable) === stableJson(payload)) counts.unchanged += 1;
      else counts.updated += 1;
      await collection.updateOne(
        filter,
        { $setOnInsert: { createdAt: item.createdAt }, $set: { ...payload, updatedAt: item.updatedAt } },
        { upsert: true }
      );
    }
    return counts;
  }

  async listObservationsByRun(ingestionRunId, limit = 1000) {
    await this.initialize();
    return this.observations.find({ ingestionRunId }).limit(limit).toArray();
  }

  async close() {
    if (this.ownsClient) await this.client.close();
  }
}

function withoutMongoId({ _id, ...value }) {
  return value;
}

module.exports = MongoDbUc1ProjectionStore;
