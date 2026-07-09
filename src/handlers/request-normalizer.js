const env = require('../config/env');
const AppError = require('../utils/app-error');

const SUPPORTED_RESPONSE_PROFILES = new Set([
  'standard',
  'copernicus-compatibility',
  'scene-search-compatibility',
  'scene-download-compatibility',
  'water-quality-statistics',
  'sentinel-3-surface-temperature',
  'water-tile-screening',
  'target-date-image'
]);

function normalizeRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be a JSON object', 400, 'INVALID_REQUEST');
  }

  const source = payload.source || payload.provider;
  if (!source) {
    throw new AppError('source or provider is required', 400, 'VALIDATION_ERROR');
  }

  if (!payload.mode) {
    throw new AppError('mode is required', 400, 'VALIDATION_ERROR');
  }

  const requestParams = normalizeRequestParams(payload);

  const responseProfile = payload.responseProfile || 'standard';
  if (!SUPPORTED_RESPONSE_PROFILES.has(responseProfile)) {
    throw new AppError(`responseProfile must be one of: ${Array.from(SUPPORTED_RESPONSE_PROFILES).join(', ')}`, 400, 'VALIDATION_ERROR');
  }

  validateBbox(requestParams.bbox);
  validateTiles(requestParams.tiles);
  validateDate(requestParams.dateFrom, 'dateFrom');
  validateDate(requestParams.dateTo, 'dateTo');
  validateDate(requestParams.date, 'date');

  return {
    source: String(source).trim().toLowerCase(),
    mode: String(payload.mode || env.copernicus.apiMode).trim().toLowerCase(),
    collection: payload.collection ? String(payload.collection).trim() : 'sentinel-2-l2a',
    datasetType: String(payload.datasetType || 'catalogue').trim().toLowerCase(),
    format: String(payload.format || requestParams.format || 'json').trim().toLowerCase(),
    responseProfile,
    query: {
      bbox: requestParams.bbox,
      dateFrom: requestParams.dateFrom || '',
      dateTo: requestParams.dateTo || '',
      cloudCoverageMax: requestParams.cloudCoverageMax ?? requestParams.maxCloudPct ?? null,
      maxCloudCoverage: requestParams.maxCloudCoverage ?? requestParams.cloudCoverageMax ?? requestParams.maxCloudPct ?? null,
      limit: normalizeLimit(requestParams.limit),
      maxImages: normalizeMaxImages(requestParams.maxImages || requestParams.max_images || requestParams.limit),
      scene: requestParams.scene || null,
      product: requestParams.product || '',
      tiles: normalizeTiles(requestParams.tiles),
      date: requestParams.date || requestParams.dateFrom || '',
      tileName: requestParams.tileName || requestParams.tile_name || 'tile',
      tileSize: normalizeTileSize(requestParams.tileSize || requestParams.tile_size || 400),
      imageKeys: normalizeImageKeys(requestParams.imageKeys || requestParams.image_keys || ['true_color']),
      outputFormat: requestParams.format || requestParams.outputFormat || payload.format || 'image/png',
      crs: requestParams.crs,
      upsampling: requestParams.upsampling,
      downsampling: requestParams.downsampling
    },
    options: {
      download: payload.download === true
    }
  };
}

function normalizeRequestParams(payload) {
  if (payload.requestParams !== undefined) {
    if (!payload.requestParams || typeof payload.requestParams !== 'object' || Array.isArray(payload.requestParams)) {
      throw new AppError('requestParams must be an object when provided', 400, 'VALIDATION_ERROR');
    }

    return payload.requestParams;
  }

  const fields = [
    'bbox',
    'dateFrom',
    'dateTo',
    'date',
    'cloudCoverageMax',
    'maxCloudCoverage',
    'maxCloudPct',
    'limit',
    'maxImages',
    'scene',
    'product',
    'tiles',
    'tileName',
    'tileSize',
    'imageKeys',
    'outputFormat',
    'format',
    'crs',
    'upsampling',
    'downsampling'
  ];

  const flatParams = fields.reduce((params, field) => {
    if (payload[field] !== undefined) {
      params[field] = payload[field];
    }

    return params;
  }, {});

  if (Object.keys(flatParams).length === 0) {
    throw new AppError('requestParams or flat request query parameters are required', 400, 'VALIDATION_ERROR');
  }

  return flatParams;
}

function validateTiles(tiles) {
  if (tiles === undefined) {
    return;
  }

  if (!Array.isArray(tiles) || tiles.length === 0) {
    throw new AppError('tiles must be a non-empty array', 400, 'VALIDATION_ERROR');
  }

  for (const tile of tiles) {
    if (!tile || typeof tile !== 'object') {
      throw new AppError('each tile must be an object', 400, 'VALIDATION_ERROR');
    }

    validateBbox(tile.bbox);
  }
}

function validateBbox(bbox) {
  if (bbox === undefined) {
    return;
  }

  const valid = Array.isArray(bbox)
    && bbox.length === 4
    && bbox.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));

  if (!valid) {
    throw new AppError('bbox must contain exactly four numbers', 400, 'VALIDATION_ERROR');
  }
}

function validateDate(value, fieldName) {
  if (!value) {
    return;
  }

  if (Number.isNaN(Date.parse(value))) {
    throw new AppError(`${fieldName} must be a valid date`, 400, 'VALIDATION_ERROR');
  }
}

function normalizeLimit(value) {
  const limit = Number(value || 10);

  if (!Number.isInteger(limit) || limit < 1) {
    throw new AppError('limit must be a positive integer', 400, 'VALIDATION_ERROR');
  }

  if (limit > env.maxCatalogueLimit) {
    throw new AppError(`limit must not exceed ${env.maxCatalogueLimit}`, 400, 'VALIDATION_ERROR');
  }

  return limit;
}

function normalizeMaxImages(value) {
  const maxImages = Number(value || 10);

  if (!Number.isInteger(maxImages) || maxImages < 1) {
    throw new AppError('maxImages must be a positive integer', 400, 'VALIDATION_ERROR');
  }

  return maxImages;
}

function normalizeTileSize(value) {
  const tileSize = Number(value || 400);

  if (!Number.isInteger(tileSize) || tileSize < 1) {
    throw new AppError('tileSize must be a positive integer', 400, 'VALIDATION_ERROR');
  }

  return tileSize;
}

function normalizeImageKeys(value) {
  if (Array.isArray(value)) {
    return value.map((key) => String(key).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value.split(',').map((key) => key.trim()).filter(Boolean);
  }

  return ['true_color'];
}

function normalizeTiles(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((tile, index) => ({
    name: tile.name ? String(tile.name) : `tile_${index}`,
    bbox: tile.bbox
  }));
}

module.exports = {
  normalizeRequest
};
