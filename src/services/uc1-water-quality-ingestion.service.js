const AppError = require('../utils/app-error');
const { normalizeRequest } = require('../handlers/request-normalizer');
const { getSourceAdapter } = require('../sources/source.registry');
const { getWrapper } = require('../wrappers/wrapper.registry');
const { normalizeUc1Request } = require('../validation/uc1-aoi-request');
const { METRICS } = require('../validation/water-quality-observation');

class Uc1WaterQualityIngestionService {
  constructor({
    config,
    osmAdapter,
    tileGenerator,
    projectionStore,
    persistence,
    sentinel3Adapter,
    discoverSentinel2 = defaultDiscoverSentinel2,
    collectSentinel2 = defaultCollectSentinel2
  }) {
    this.config = config;
    this.osmAdapter = osmAdapter;
    this.tileGenerator = tileGenerator;
    this.projectionStore = projectionStore;
    this.persistence = persistence;
    this.sentinel3Adapter = sentinel3Adapter;
    this.discoverSentinel2 = discoverSentinel2;
    this.collectSentinel2 = collectSentinel2;
  }

  async run(payload, { idempotencyKey } = {}) {
    const request = normalizeUc1Request(payload, this.config.uc1);
    if (!this.persistence || !this.projectionStore) {
      throw new AppError('UC1 AOI ingestion requires persistence to be enabled', 503, 'PERSISTENCE_DISABLED');
    }
    if (request.options.includeSentinel2Images) {
      throw new AppError(
        'AOI image acquisition requires an explicit source scene selection contract',
        501,
        'UC1_IMAGE_SCENE_REQUIRED'
      );
    }
    const riverNetwork = await this.osmAdapter.fetchRiverNetwork(request.aoi);
    const tiles = this.tileGenerator.generate({
      aoi: request.aoi,
      riverNetwork,
      params: request.tile
    });
    const sceneItems = request.options.includeSentinel2Statistics
      ? await this.discoverSentinel2(request)
      : [];
    const sourceItemIds = sceneItems.map((item) => item.id).filter(Boolean).sort();
    const observations = [];
    if (request.options.includeSentinel2Statistics) {
      for (const tile of tiles) {
        observations.push(...await this.collectSentinel2({ request, tile, sourceItemIds }));
      }
    }
    if (request.options.includeSentinel3) {
      observations.push(...await this.sentinel3Adapter.collect({ request, tiles }));
    }

    const now = new Date().toISOString();
    const ingestionRunId = request.operation.ingestionRunId;
    const projectedTiles = tiles.map((tile) => ({ ...tile, ingestionRunId, updatedAt: now }));
    const projectedObservations = observations.map((observation) => this.toProjection(observation, now));
    const tileChanges = await this.projectionStore.upsertTiles(projectedTiles, ingestionRunId);
    const observationChanges = await this.projectionStore.upsertObservations(projectedObservations, ingestionRunId);

    const result = {
      ingestionRunId,
      source: request.source,
      mode: request.mode,
      collection: request.collection,
      responseProfile: request.responseProfile,
      data: {
        aoi: request.aoi,
        riverNetwork: {
          source: riverNetwork.source,
          riverCount: riverNetwork.rivers.length,
          riverNetworkHash: tiles[0].riverNetworkHash
        },
        tiles: request.options.includeTiles ? projectedTiles : [],
        observations: projectedObservations
      },
      metadata: {
        type: 'uc1-water-quality-aoi',
        terminalStatus: 'success',
        requestedInterval: { from: request.query.dateFrom, to: request.query.dateTo },
        tileCount: tiles.length,
        observationCount: projectedObservations.length,
        sourceProductCount: sourceItemIds.length,
        providers: ['osm-overpass', ...(request.options.includeSentinel2Statistics ? ['copernicus-sentinel-2'] : [])],
        projectedTileCount: projectedTiles.length,
        projectedObservationCount: projectedObservations.length,
        warnings: [],
        completedAt: now
      }
    };
    const persisted = await this.persistence.persist({
      payload,
      normalizedRequest: request,
      result,
      explicitIdempotencyKey: idempotencyKey
    });
    return {
      ...persisted.result,
      persistence: persisted.persistence,
      projections: {
        tiles: tileChanges,
        observations: observationChanges
      }
    };
  }

  toProjection(observation, now) {
    const sourceProductId = observation.source_item_ids?.length
      ? [...observation.source_item_ids].sort().join(',')
      : observation.source_collection || 'sentinel-2-l2a';
    return {
      observationId: [
        observation.aoi_id, observation.tile_id, observation.observation_date,
        observation.source_name, sourceProductId
      ].join(':'),
      ingestionRunId: observation.ingestion_run_id,
      aoiId: observation.aoi_id,
      aoiDefinitionHash: observation.aoi_definition_hash,
      tileId: observation.tile_id,
      observationDate: observation.observation_date,
      provider: observation.source_name,
      sourceProductId,
      bbox: observation.bbox,
      metrics: Object.fromEntries(METRICS.map((metric) => [metric, observation[metric]])),
      qualityFlags: observation.quality_flags || [],
      provenance: {
        collection: observation.source_collection,
        sourceItemIds: observation.source_item_ids || [],
        sourceSceneCount: observation.source_scene_count || 0,
        acquisitionTimestamp: observation.acquisition_timestamp
      },
      objectRefs: Object.values(observation.artifact_refs || {}),
      water: {
        status: observation.water_status,
        checkStatus: observation.water_check_status,
        waterPct: observation.water_pct,
        cloudPct: observation.cloud_pct,
        validPixels: observation.valid_pixels
      },
      status: observation.collection_status,
      createdAt: now,
      updatedAt: now
    };
  }
}

async function defaultDiscoverSentinel2(request) {
  const normalized = normalizeRequest({
    source: 'copernicus',
    mode: 'stac',
    collection: 'sentinel-2-l2a',
    datasetType: 'catalogue',
    responseProfile: 'standard',
    format: 'json',
    requestParams: {
      bbox: request.aoi.bbox,
      dateFrom: request.query.dateFrom,
      dateTo: request.query.dateTo,
      cloudCoverageMax: request.query.cloudCoverageMax,
      limit: 100
    }
  });
  const adapter = getSourceAdapter('copernicus');
  const response = await adapter.fetchData(normalized);
  return Array.isArray(response.rawData?.features) ? response.rawData.features : [];
}

async function defaultCollectSentinel2({ request, tile, sourceItemIds }) {
  const normalized = normalizeRequest({
    source: 'copernicus',
    mode: 'sentinel-hub-statistics',
    collection: 'sentinel-2-l2a',
    datasetType: 'water-quality-observations',
    responseProfile: 'sentinel-2-observations',
    format: 'json',
    requestParams: {
      ingestionRunId: request.operation.ingestionRunId,
      aoiId: request.aoi.aoiId,
      aoiDefinitionHash: request.aoi.aoiDefinitionHash,
      tileId: tile.tileId,
      bbox: tile.bbox,
      geometryReference: { tileId: tile.tileId },
      dateFrom: request.query.dateFrom,
      dateTo: request.query.dateTo,
      cloudCoverageMax: request.query.cloudCoverageMax,
      sourceItemIds
    }
  });
  const adapter = getSourceAdapter('copernicus');
  const response = await adapter.fetchData(normalized);
  const wrapper = getWrapper(normalized);
  return wrapper.transform(response.rawData, adapter.extractMetadata(response), normalized).data.observations;
}

module.exports = Uc1WaterQualityIngestionService;
