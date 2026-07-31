const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUc1Request } = require('../src/validation/uc1-aoi-request');
const OsmOverpassAdapter = require('../src/sources/osm-overpass.adapter');
const RiverTileGenerator = require('../src/domain/uc1/river-tile-generator');
const Sentinel3Adapter = require('../src/sources/sentinel3.adapter');
const Uc1WaterQualityIngestionService = require('../src/services/uc1-water-quality-ingestion.service');
const IngestionRunQueryService = require('../src/services/ingestion-run-query.service');
const IngestionPersistenceService = require('../src/services/ingestion-persistence.service');
const InMemoryIngestionStore = require('../src/adapters/ingestion-store/in-memory-ingestion-store.fake');
const InMemoryObjectStore = require('../src/adapters/object-store/in-memory-object-store.fake');
const InMemoryUc1ProjectionStore = require('../src/adapters/uc1-projection-store/in-memory-uc1-projection-store.fake');

const config = {
  retryAttempts: 2,
  retryBaseDelayMs: 0,
  osm: { overpassUrl: 'https://overpass.test/api', timeoutMs: 1000 },
  uc1: {
    spacingM: 400,
    sizeM: 400,
    minRiverLengthM: 0,
    maxTilesPerRun: 10,
    maxDaysPerRun: 31,
    enableSentinel3: false
  }
};

function payload(overrides = {}) {
  return {
    useCaseId: 'uc1-forecaster',
    provider: 'uc1',
    mode: 'aoi-water-quality',
    responseProfile: 'uc1-water-quality-aoi',
    idempotencyKey: 'uc1-request-1',
    aoi: {
      aoiId: 'sperchios',
      name: 'Sperchios',
      bbox: [22, 38, 22.1, 38.1]
    },
    dateFrom: '2026-01-01',
    dateTo: '2026-01-02',
    tile: { spacingM: 400, sizeM: 400, minRiverLengthM: 0, maxTiles: 2 },
    options: {
      includeTiles: true,
      includeSentinel2Statistics: true,
      includeSentinel2Images: false,
      includeSentinel3: false
    },
    ...overrides
  };
}

function riverNetwork() {
  return {
    source: 'osm-overpass',
    aoiId: 'sperchios',
    rivers: [{
      riverId: 'river-1',
      name: 'River',
      geometry: { type: 'LineString', coordinates: [[22, 38], [22.02, 38.02]] },
      tags: { waterway: 'river' }
    }]
  };
}

test('validates and normalizes an AOI request deterministically', () => {
  const first = normalizeUc1Request(payload(), config.uc1);
  const second = normalizeUc1Request(payload(), config.uc1);
  assert.equal(first.aoi.aoiDefinitionHash, second.aoi.aoiDefinitionHash);
  assert.equal(first.operation.ingestionRunId, 'uc1-request-1');
  assert.throws(() => normalizeUc1Request(payload({ aoi: { aoiId: '', bbox: [22, 38, 22.1, 38.1] } }), config.uc1), /aoiId/);
  assert.throws(() => normalizeUc1Request(payload({ aoi: { aoiId: 'x', bbox: [22, 38, 21, 39] } }), config.uc1), /bbox/);
  assert.throws(() => normalizeUc1Request(payload({ dateFrom: '2026-02-01' }), config.uc1), /dateFrom/);
});

test('Overpass adapter normalizes river ways and rejects empty/malformed responses', async () => {
  const client = {
    async post() {
      return {
        status: 200,
        data: {
          elements: [{
            type: 'way',
            id: 10,
            tags: { waterway: 'river', name: 'Test' },
            geometry: [{ lon: 22, lat: 38 }, { lon: 22.01, lat: 38.01 }]
          }]
        }
      };
    }
  };
  const adapter = new OsmOverpassAdapter({ config, client, sleep: async () => {} });
  const result = await adapter.fetchRiverNetwork({ aoiId: 'aoi', bbox: [22, 38, 22.1, 38.1] });
  assert.equal(result.rivers[0].geometry.type, 'LineString');
  assert.match(adapter.buildQuery([22, 38, 22.1, 38.1]), /waterway/);

  const empty = new OsmOverpassAdapter({
    config,
    client: { post: async () => ({ status: 200, data: { elements: [] } }) },
    sleep: async () => {}
  });
  await assert.rejects(() => empty.fetchRiverNetwork({ aoiId: 'aoi', bbox: [22, 38, 22.1, 38.1] }), /No river network/);
  assert.throws(() => adapter.normalize({ invalid: true }, { aoiId: 'aoi' }), /invalid shape/);
});

test('river tiles have stable IDs, valid geometry, and change with parameters', () => {
  const generator = new RiverTileGenerator();
  const aoi = { aoiId: 'sperchios', aoiDefinitionHash: 'hash' };
  const params = { spacingM: 400, sizeM: 400, minRiverLengthM: 0, maxTiles: 5 };
  const first = generator.generate({ aoi, riverNetwork: riverNetwork(), params, now: '2026-01-01T00:00:00Z' });
  const second = generator.generate({ aoi, riverNetwork: riverNetwork(), params, now: '2026-01-02T00:00:00Z' });
  const changed = generator.generate({ aoi, riverNetwork: riverNetwork(), params: { ...params, sizeM: 500 } });
  assert.deepEqual(first.map((tile) => tile.tileId), second.map((tile) => tile.tileId));
  assert.notEqual(first[0].tileId, changed[0].tileId);
  assert.equal(first[0].geometry.type, 'Polygon');
  assert.equal(new Set(first.map((tile) => tile.tileId)).size, first.length);
});

test('AOI orchestration persists ingestion result and idempotent projections without local files', async () => {
  const ingestionStore = new InMemoryIngestionStore();
  const objectStore = new InMemoryObjectStore();
  const projectionStore = new InMemoryUc1ProjectionStore();
  const persistence = new IngestionPersistenceService({ ingestionStore, objectStore, bucket: 'terra-bucket' });
  const service = new Uc1WaterQualityIngestionService({
    config,
    osmAdapter: { fetchRiverNetwork: async () => riverNetwork() },
    tileGenerator: new RiverTileGenerator(),
    projectionStore,
    persistence,
    sentinel3Adapter: new Sentinel3Adapter(config),
    discoverSentinel2: async () => [{ id: 'S2_SCENE' }],
    collectSentinel2: async ({ request, tile, sourceItemIds }) => [
      observation(request, tile, sourceItemIds, '2026-01-01')
    ]
  });

  const first = await service.run(payload(), { idempotencyKey: 'uc1-request-1' });
  const second = await service.run(payload(), { idempotencyKey: 'uc1-request-1' });
  assert.equal(first.persistence.operation, 'inserted');
  assert.equal(second.persistence.operation, 'unchanged');
  assert.equal(ingestionStore.records.size, 1);
  assert.equal(projectionStore.tiles.size, 2);
  assert.equal(projectionStore.observations.size, 2);
  assert.equal(objectStore.objects.size, 0);
  assert.equal(first.metadata.tileCount, 2);
});

test('projection changes update observations and run query omits binary content', async () => {
  const ingestionStore = new InMemoryIngestionStore();
  const projectionStore = new InMemoryUc1ProjectionStore();
  const objectStore = new InMemoryObjectStore();
  const persistence = new IngestionPersistenceService({ ingestionStore, objectStore, bucket: 'terra-bucket' });
  let metric = 1;
  const service = new Uc1WaterQualityIngestionService({
    config,
    osmAdapter: { fetchRiverNetwork: async () => riverNetwork() },
    tileGenerator: new RiverTileGenerator(),
    projectionStore,
    persistence,
    sentinel3Adapter: new Sentinel3Adapter(config),
    discoverSentinel2: async () => [{ id: 'S2_SCENE' }],
    collectSentinel2: async ({ request, tile, sourceItemIds }) => {
      const value = observation(request, tile, sourceItemIds, '2026-01-01');
      value.CDOM = metric;
      return [value];
    }
  });
  await service.run(payload(), { idempotencyKey: 'uc1-request-1' });
  metric = 2;
  const updated = await service.run(payload(), { idempotencyKey: 'uc1-request-1' });
  assert.equal(updated.persistence.operation, 'updated');
  assert.equal(updated.projections.observations.updated, 2);

  const query = new IngestionRunQueryService({ ingestionStore, projectionStore });
  const result = await query.get('uc1-request-1', 'results');
  assert.equal(result.observations.length, 2);
  assert.equal(JSON.stringify(result).includes('dataBase64'), false);
  await assert.rejects(() => query.get('missing'), /not found/);
});

test('Sentinel-3 returns a typed not-configured error', async () => {
  const adapter = new Sentinel3Adapter(config);
  await assert.rejects(
    () => adapter.collect(),
    (error) => error.code === 'SENTINEL3_NOT_CONFIGURED' && error.statusCode === 501
  );
});

function observation(request, tile, sourceItemIds, date) {
  return {
    schema_version: '1.0.0',
    ingestion_run_id: request.operation.ingestionRunId,
    aoi_id: request.aoi.aoiId,
    aoi_definition_hash: request.aoi.aoiDefinitionHash,
    tile_id: tile.tileId,
    observation_date: date,
    bbox: tile.bbox,
    collection_status: 'collected',
    source_name: 'copernicus',
    source_collection: 'sentinel-2-l2a',
    source_item_ids: sourceItemIds,
    source_scene_count: sourceItemIds.length,
    acquisition_timestamp: '2026-01-01T00:00:00Z',
    water_status: 'unknown',
    water_check_status: 'not_performed',
    water_pct: null,
    cloud_pct: null,
    valid_pixels: 10,
    quality_flags: [],
    artifact_refs: {},
    CDOM: 1,
    Chl_a: 2,
    Color: 3,
    Cya: 4,
    DOC: 5,
    Turb: 6,
    WQI: 0.7
  };
}
