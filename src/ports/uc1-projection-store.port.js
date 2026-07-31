class Uc1ProjectionStorePort {
  async upsertTiles() { throw new Error('upsertTiles must be implemented'); }
  async upsertObservations() { throw new Error('upsertObservations must be implemented'); }
  async listObservationsByRun() { throw new Error('listObservationsByRun must be implemented'); }
}

module.exports = Uc1ProjectionStorePort;
