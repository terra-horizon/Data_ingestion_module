const Uc1ProjectionStorePort = require('../../ports/uc1-projection-store.port');
const { stableJson } = require('../../services/persistence-utils');

class InMemoryUc1ProjectionStore extends Uc1ProjectionStorePort {
  constructor() {
    super();
    this.tiles = new Map();
    this.observations = new Map();
  }

  async upsertTiles(tiles, ingestionRunId) {
    return this.upsert(this.tiles, tiles, (tile) => `${tile.aoiId}/${tile.tileId}`, ingestionRunId);
  }

  async upsertObservations(observations, ingestionRunId) {
    return this.upsert(
      this.observations,
      observations,
      (observation) => [
        observation.aoiId, observation.tileId, observation.observationDate,
        observation.provider, observation.sourceProductId
      ].join('/'),
      ingestionRunId
    );
  }

  async listObservationsByRun(ingestionRunId, limit = 1000) {
    return [...this.observations.values()]
      .filter((item) => item.ingestionRunId === ingestionRunId)
      .slice(0, limit)
      .map((item) => structuredClone(item));
  }

  async upsert(store, items, keyOf, ingestionRunId) {
    const counts = { inserted: 0, updated: 0, unchanged: 0 };
    for (const source of items) {
      const key = keyOf(source);
      const existing = store.get(key);
      const item = { ...structuredClone(source), lastIngestionRunId: ingestionRunId };
      if (existing) item.createdAt = existing.createdAt;
      const previousComparable = existing ? { ...existing, updatedAt: item.updatedAt, lastIngestionRunId: ingestionRunId } : null;
      const operation = !existing ? 'inserted' : stableJson(previousComparable) === stableJson(item) ? 'unchanged' : 'updated';
      counts[operation] += 1;
      store.set(key, { ...(existing || {}), ...item, createdAt: existing?.createdAt || item.createdAt });
    }
    return counts;
  }
}

module.exports = InMemoryUc1ProjectionStore;
