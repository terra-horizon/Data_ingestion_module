const dotenv = require('dotenv');

dotenv.config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
  retryAttempts: Number(process.env.RETRY_ATTEMPTS || 3),
  retryBaseDelayMs: Number(process.env.RETRY_BASE_DELAY_MS || 1000),
  maxCatalogueLimit: Number(process.env.MAX_CATALOGUE_LIMIT || 100),
  persistence: {
    enabled: parseBoolean(process.env.PERSISTENCE_ENABLED, false),
    mongo: {
      uri: process.env.MONGO_URI || 'mongodb://terra-mongodb:27017/terra_db',
      dbName: process.env.MONGO_DB_NAME || 'terra_db',
      collection: process.env.MONGO_INGESTION_COLLECTION || 'ingestion_results',
      tilesCollection: process.env.MONGO_UC1_TILES_COLLECTION || 'uc1_tiles',
      observationsCollection: process.env.MONGO_UC1_OBSERVATIONS_COLLECTION || 'uc1_observations'
    },
    s3: {
      endpoint: process.env.S3_ENDPOINT || 'terra-minio',
      port: Number(process.env.S3_PORT || 9000),
      useSsl: parseBoolean(process.env.S3_USE_SSL, false),
      accessKey: process.env.S3_ACCESS_KEY || '',
      secretKey: process.env.S3_SECRET_KEY || '',
      bucket: process.env.S3_BUCKET || 'terra-bucket',
      region: process.env.S3_REGION || 'us-east-1'
    }
  },
  osm: {
    overpassUrl: process.env.OSM_OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
    timeoutMs: Number(process.env.OSM_OVERPASS_TIMEOUT_MS || 30000)
  },
  uc1: {
    spacingM: Number(process.env.UC1_TILE_SPACING_METERS || 400),
    sizeM: Number(process.env.UC1_TILE_SIZE_METERS || 400),
    minRiverLengthM: Number(process.env.UC1_MIN_RIVER_LENGTH_METERS || 10000),
    maxTilesPerRun: Number(process.env.UC1_MAX_TILES_PER_RUN || 500),
    maxDaysPerRun: Number(process.env.UC1_MAX_DAYS_PER_RUN || 366),
    enableSentinel3: parseBoolean(process.env.UC1_ENABLE_SENTINEL3, false)
  },
  copernicus: {
    apiMode: process.env.COPERNICUS_API_MODE || 'stac',
    stacBaseUrl: process.env.COPERNICUS_STAC_BASE_URL || 'https://stac.dataspace.copernicus.eu/v1',
    shCatalogUrl: process.env.COPERNICUS_SH_CATALOG_URL || 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search',
    shProcessUrl: process.env.COPERNICUS_SH_PROCESS_URL || 'https://sh.dataspace.copernicus.eu/api/v1/process',
    shStatisticsUrl: process.env.COPERNICUS_SH_STATISTICS_URL || 'https://sh.dataspace.copernicus.eu/api/v1/statistics',
    odataBaseUrl: process.env.COPERNICUS_ODATA_BASE_URL || 'https://catalogue.dataspace.copernicus.eu/odata/v1',
    tokenUrl: process.env.COPERNICUS_TOKEN_URL || 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    clientId: process.env.COPERNICUS_CLIENT_ID || '',
    clientSecret: process.env.COPERNICUS_CLIENT_SECRET || '',
    username: process.env.COPERNICUS_USERNAME || '',
    password: process.env.COPERNICUS_PASSWORD || '',
    accessToken: process.env.COPERNICUS_ACCESS_TOKEN || ''
  }
};

env.copernicus.credentialSets = buildCredentialSets();

function buildCredentialSets() {
  const sets = [];
  addCredentialSet(sets, 'primary', process.env.COPERNICUS_CLIENT_ID, process.env.COPERNICUS_CLIENT_SECRET);
  addCredentialSet(
    sets,
    'backup',
    process.env.COPERNICUS_BACKUP_CLIENT_ID || process.env.COPERNICUS_FALLBACK_CLIENT_ID,
    process.env.COPERNICUS_BACKUP_CLIENT_SECRET || process.env.COPERNICUS_FALLBACK_CLIENT_SECRET
  );

  for (let index = 2; index <= 9; index += 1) {
    addCredentialSet(
      sets,
      `backup_${index}`,
      process.env[`COPERNICUS_BACKUP_${index}_CLIENT_ID`],
      process.env[`COPERNICUS_BACKUP_${index}_CLIENT_SECRET`]
    );
  }

  return sets;
}

function addCredentialSet(sets, label, clientId, clientSecret) {
  if (clientId && clientSecret) {
    sets.push({ label, clientId, clientSecret });
  }
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

module.exports = env;
