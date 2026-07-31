function observationPayload(overrides = {}) {
  return {
    source: 'Copernicus',
    mode: 'sentinel-hub-statistics',
    collection: 'sentinel-2-l2a',
    datasetType: 'water-quality-observations',
    responseProfile: 'sentinel-2-observations',
    format: 'json',
    requestParams: {
      ingestionRunId: 'run-123',
      aoiId: 'sperchios',
      aoiDefinitionHash: 'hash-123',
      tileId: 'tile_0',
      bbox: [22, 38, 22.1, 38.1],
      dateFrom: '2026-01-01',
      dateTo: '2026-01-02',
      cloudCoverageMax: 30,
      sourceItemIds: ['S2_B', 'S2_A', 'S2_A'],
      ...overrides
    }
  };
}

module.exports = { observationPayload };
