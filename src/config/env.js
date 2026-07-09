const dotenv = require('dotenv');

dotenv.config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
  cdseProcessTimeoutMs: Number(process.env.CDSE_PROCESS_TIMEOUT_MS || 60000),
  cdseStatisticsTimeoutMs: Number(process.env.CDSE_STATISTICS_TIMEOUT_MS || 120000),
  cdseRateLimitRetryDelaySeconds: Number(process.env.CDSE_RATE_LIMIT_RETRY_DELAY_SECONDS || 180),
  cdseMaxRetries: Number(process.env.CDSE_MAX_RETRIES || 3),
  maxCatalogueLimit: Number(process.env.MAX_CATALOGUE_LIMIT || 100),
  mongo: {
    uri: process.env.MONGO_URI || '',
    database: process.env.MONGO_DB_NAME || process.env.MONGO_DATABASE || '',
    metadataCollection: process.env.MONGO_METADATA_COLLECTION || ''
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || '',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
    bucket: process.env.S3_BUCKET || '',
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() === 'true'
  },
  copernicus: {
    apiMode: process.env.COPERNICUS_API_MODE || 'stac',
    stacBaseUrl: process.env.COPERNICUS_STAC_BASE_URL || 'https://stac.dataspace.copernicus.eu/v1',
    shStatisticsUrl: process.env.CDSE_SH_STATISTICS_URL || process.env.COPERNICUS_SH_STATISTICS_URL || 'https://sh.dataspace.copernicus.eu/api/v1/statistics',
    shCatalogUrl: process.env.COPERNICUS_SH_CATALOG_URL || 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search',
    shProcessUrl: process.env.CDSE_SH_PROCESS_URL || process.env.COPERNICUS_SH_PROCESS_URL || 'https://sh.dataspace.copernicus.eu/api/v1/process',
    odataBaseUrl: process.env.COPERNICUS_ODATA_BASE_URL || 'https://catalogue.dataspace.copernicus.eu/odata/v1',
    tokenUrl: process.env.CDSE_TOKEN_URL || process.env.COPERNICUS_TOKEN_URL || 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    clientId: process.env.CDSE_CLIENT_ID || process.env.COPERNICUS_CLIENT_ID || '',
    clientSecret: process.env.CDSE_CLIENT_SECRET || process.env.COPERNICUS_CLIENT_SECRET || '',
    backupClientId: process.env.CDSE_BACKUP_CLIENT_ID || process.env.CDSE_FALLBACK_CLIENT_ID || '',
    backupClientSecret: process.env.CDSE_BACKUP_CLIENT_SECRET || process.env.CDSE_FALLBACK_CLIENT_SECRET || '',
    username: process.env.COPERNICUS_USERNAME || '',
    password: process.env.COPERNICUS_PASSWORD || '',
    accessToken: process.env.COPERNICUS_ACCESS_TOKEN || ''
  }
};

env.copernicus.credentialSets = [
  {
    label: 'primary',
    clientId: env.copernicus.clientId,
    clientSecret: env.copernicus.clientSecret
  }
];

if (env.copernicus.backupClientId && env.copernicus.backupClientSecret) {
  env.copernicus.credentialSets.push({
    label: 'backup',
    clientId: env.copernicus.backupClientId,
    clientSecret: env.copernicus.backupClientSecret
  });
}

for (let index = 2; index < 10; index += 1) {
  const clientId = process.env[`CDSE_BACKUP_${index}_CLIENT_ID`];
  const clientSecret = process.env[`CDSE_BACKUP_${index}_CLIENT_SECRET`];

  if (clientId && clientSecret) {
    env.copernicus.credentialSets.push({
      label: `backup_${index}`,
      clientId,
      clientSecret
    });
  }
}

module.exports = env;


