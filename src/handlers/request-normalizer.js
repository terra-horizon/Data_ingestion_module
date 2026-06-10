const env = require('../config/env');
const AppError = require('../utils/app-error');

const SUPPORTED_RESPONSE_PROFILES = new Set([
  'standard',
  'copernicus-compatibility',
  'scene-search-compatibility',
  'scene-download-compatibility'
]);

function normalizeRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be a JSON object', 400, 'INVALID_REQUEST');
  }

  if (!payload.source) {
    throw new AppError('source is required', 400, 'VALIDATION_ERROR');
  }

  if (!payload.requestParams || typeof payload.requestParams !== 'object' || Array.isArray(payload.requestParams)) {
    throw new AppError('requestParams is required and must be an object', 400, 'VALIDATION_ERROR');
  }

  const responseProfile = payload.responseProfile || 'standard';
  if (!SUPPORTED_RESPONSE_PROFILES.has(responseProfile)) {
    throw new AppError('responseProfile must be one of: standard, copernicus-compatibility, scene-search-compatibility, scene-download-compatibility', 400, 'VALIDATION_ERROR');
  }

  const { requestParams } = payload;
  validateBbox(requestParams.bbox);
  validateDate(requestParams.dateFrom, 'dateFrom');
  validateDate(requestParams.dateTo, 'dateTo');

  return {
    source: String(payload.source).trim().toLowerCase(),
    mode: String(payload.mode || env.copernicus.apiMode).trim().toLowerCase(),
    collection: payload.collection ? String(payload.collection).trim() : 'sentinel-2-l2a',
    datasetType: String(payload.datasetType || 'catalogue').trim().toLowerCase(),
    format: String(payload.format || 'json').trim().toLowerCase(),
    responseProfile,
    query: {
      bbox: requestParams.bbox,
      dateFrom: requestParams.dateFrom || '',
      dateTo: requestParams.dateTo || '',
      cloudCoverageMax: requestParams.cloudCoverageMax ?? requestParams.maxCloudPct ?? null,
      limit: normalizeLimit(requestParams.limit),
      maxImages: normalizeMaxImages(requestParams.maxImages || requestParams.max_images || requestParams.limit),
      scene: requestParams.scene || null
    },
    options: {
      download: payload.download === true
    }
  };
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

module.exports = {
  normalizeRequest
};
