const dotenv = require('dotenv');

dotenv.config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
  maxCatalogueLimit: Number(process.env.MAX_CATALOGUE_LIMIT || 100),
  copernicus: {
    apiMode: process.env.COPERNICUS_API_MODE || 'stac',
    stacBaseUrl: process.env.COPERNICUS_STAC_BASE_URL || 'https://stac.dataspace.copernicus.eu/v1',
    shCatalogUrl: process.env.COPERNICUS_SH_CATALOG_URL || 'https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search',
    shProcessUrl: process.env.COPERNICUS_SH_PROCESS_URL || 'https://sh.dataspace.copernicus.eu/api/v1/process',
    odataBaseUrl: process.env.COPERNICUS_ODATA_BASE_URL || 'https://catalogue.dataspace.copernicus.eu/odata/v1',
    tokenUrl: process.env.COPERNICUS_TOKEN_URL || 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    clientId: process.env.COPERNICUS_CLIENT_ID || '',
    clientSecret: process.env.COPERNICUS_CLIENT_SECRET || '',
    username: process.env.COPERNICUS_USERNAME || '',
    password: process.env.COPERNICUS_PASSWORD || '',
    accessToken: process.env.COPERNICUS_ACCESS_TOKEN || ''
  }
};

module.exports = env;
