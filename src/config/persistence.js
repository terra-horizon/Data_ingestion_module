const env = require('./env');
const MongoDbIngestionStore = require('../adapters/ingestion-store/mongodb-ingestion-store.adapter');
const MinioObjectStore = require('../adapters/object-store/minio-object-store.adapter');
const IngestionPersistenceService = require('../services/ingestion-persistence.service');
const MongoDbUc1ProjectionStore = require('../adapters/uc1-projection-store/mongodb-uc1-projection-store.adapter');
const OsmOverpassAdapter = require('../sources/osm-overpass.adapter');
const Sentinel3Adapter = require('../sources/sentinel3.adapter');
const RiverTileGenerator = require('../domain/uc1/river-tile-generator');
const Uc1WaterQualityIngestionService = require('../services/uc1-water-quality-ingestion.service');
const IngestionRunQueryService = require('../services/ingestion-run-query.service');

let runtime = null;

function getPersistenceService() {
  if (!env.persistence.enabled) return null;
  if (!runtime) {
    const ingestionStore = new MongoDbIngestionStore(env.persistence.mongo);
    const objectStore = new MinioObjectStore(env.persistence.s3);
    const projectionStore = new MongoDbUc1ProjectionStore(env.persistence.mongo);
    const service = new IngestionPersistenceService({
      ingestionStore,
      objectStore,
      bucket: env.persistence.s3.bucket
    });
    runtime = {
      ingestionStore,
      objectStore,
      projectionStore,
      service,
      uc1Service: new Uc1WaterQualityIngestionService({
        config: env,
        osmAdapter: new OsmOverpassAdapter(),
        tileGenerator: new RiverTileGenerator(),
        projectionStore,
        persistence: service,
        sentinel3Adapter: new Sentinel3Adapter(env)
      }),
      queryService: new IngestionRunQueryService({
        ingestionStore,
        projectionStore
      })
    };
  }
  return runtime.service;
}

function getUc1Service() {
  getPersistenceService();
  return runtime && runtime.uc1Service;
}

function getIngestionRunQueryService() {
  getPersistenceService();
  return runtime && runtime.queryService;
}

async function closePersistence() {
  if (runtime && typeof runtime.ingestionStore.close === 'function') {
    await runtime.ingestionStore.close();
  }
  if (runtime && typeof runtime.projectionStore.close === 'function') {
    await runtime.projectionStore.close();
  }
  runtime = null;
}

module.exports = {
  closePersistence,
  getIngestionRunQueryService,
  getPersistenceService,
  getUc1Service
};
