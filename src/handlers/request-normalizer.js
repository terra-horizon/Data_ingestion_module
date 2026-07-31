const { randomUUID } = require('node:crypto');
const env = require('../config/env');
const AppError = require('../utils/app-error');

const SUPPORTED_RESPONSE_PROFILES = new Set([
  'standard',
  'copernicus-compatibility',
  'scene-search-compatibility',
  'scene-download-compatibility',
  'sentinel-2-observations'
]);

function normalizeRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('Request body must be a JSON object', 400, 'INVALID_REQUEST');
  }
  if (!payload.source) throw new AppError('source is required', 400, 'VALIDATION_ERROR');
  if (!payload.requestParams || typeof payload.requestParams !== 'object' || Array.isArray(payload.requestParams)) {
    throw new AppError('requestParams is required and must be an object', 400, 'VALIDATION_ERROR');
  }

  const responseProfile = payload.responseProfile || 'standard';
  if (!SUPPORTED_RESPONSE_PROFILES.has(responseProfile)) {
    throw new AppError(`responseProfile must be one of: ${Array.from(SUPPORTED_RESPONSE_PROFILES).join(', ')}`, 400, 'VALIDATION_ERROR');
  }

  const requestParams = payload.requestParams;
  validateBbox(requestParams.bbox);
  validateDate(requestParams.dateFrom, 'dateFrom');
  validateDate(requestParams.dateTo, 'dateTo');
  validateDateRange(requestParams.dateFrom, requestParams.dateTo);
  const cloudCoverageMax = normalizeCloudCoverage(requestParams.cloudCoverageMax ?? requestParams.maxCloudPct);
  const datasetType = String(payload.datasetType || 'catalogue').trim().toLowerCase();

  if (responseProfile === 'sentinel-2-observations') {
    validateObservationRequest(payload, requestParams, datasetType);
  }

  return {
    source: String(payload.source).trim().toLowerCase(),
    mode: String(payload.mode || env.copernicus.apiMode).trim().toLowerCase(),
    collection: payload.collection ? String(payload.collection).trim() : 'sentinel-2-l2a',
    datasetType,
    format: String(payload.format || 'json').trim().toLowerCase(),
    responseProfile,
    operation: {
      ingestionRunId: String(requestParams.ingestionRunId || payload.ingestionRunId || randomUUID()),
      requestedAt: new Date().toISOString()
    },
    query: {
      aoiId: nullableString(requestParams.aoiId),
      aoiDefinitionHash: nullableString(requestParams.aoiDefinitionHash),
      tileId: nullableString(requestParams.tileId),
      bbox: requestParams.bbox,
      geometryReference: requestParams.geometryReference || null,
      dateFrom: requestParams.dateFrom || '',
      dateTo: requestParams.dateTo || '',
      cloudCoverageMax,
      limit: normalizeLimit(requestParams.limit),
      maxImages: normalizeMaxImages(requestParams.maxImages || requestParams.max_images || requestParams.limit),
      scene: requestParams.scene || null,
      sourceItemIds: normalizeStringArray(requestParams.sourceItemIds)
    },
    options: { download: payload.download === true }
  };
}

function validateObservationRequest(payload, requestParams, datasetType) {
  if (datasetType !== 'water-quality-observations') {
    throw new AppError('sentinel-2-observations requires datasetType water-quality-observations', 400, 'VALIDATION_ERROR');
  }
  if (String(payload.mode || '').toLowerCase() !== 'sentinel-hub-statistics') {
    throw new AppError('sentinel-2-observations requires mode sentinel-hub-statistics', 400, 'VALIDATION_ERROR');
  }
  for (const field of ['aoiId', 'aoiDefinitionHash', 'tileId', 'bbox', 'dateFrom', 'dateTo']) {
    if (requestParams[field] === undefined || requestParams[field] === null || requestParams[field] === '') {
      throw new AppError(`${field} is required for Sentinel-2 observations`, 400, 'VALIDATION_ERROR');
    }
  }
}

function validateBbox(bbox) {
  if (bbox === undefined) return;
  const valid = Array.isArray(bbox) && bbox.length === 4 && bbox.every(Number.isFinite);
  if (!valid) throw new AppError('bbox must contain exactly four finite numbers', 400, 'VALIDATION_ERROR');
  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3] || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90) {
    throw new AppError('bbox must be ordered [minLon, minLat, maxLon, maxLat] in EPSG:4326', 400, 'VALIDATION_ERROR');
  }
}

function validateDate(value, fieldName) {
  if (value && Number.isNaN(Date.parse(value))) throw new AppError(`${fieldName} must be a valid date`, 400, 'VALIDATION_ERROR');
}

function validateDateRange(from, to) {
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new AppError('dateFrom must be on or before dateTo', 400, 'VALIDATION_ERROR');
  }
}

function normalizeCloudCoverage(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new AppError('cloudCoverageMax must be between 0 and 100', 400, 'VALIDATION_ERROR');
  }
  return number;
}

function normalizeLimit(value) {
  const limit = Number(value || 10);
  if (!Number.isInteger(limit) || limit < 1) throw new AppError('limit must be a positive integer', 400, 'VALIDATION_ERROR');
  if (limit > env.maxCatalogueLimit) throw new AppError(`limit must not exceed ${env.maxCatalogueLimit}`, 400, 'VALIDATION_ERROR');
  return limit;
}

function normalizeMaxImages(value) {
  const maxImages = Number(value || 10);
  if (!Number.isInteger(maxImages) || maxImages < 1) throw new AppError('maxImages must be a positive integer', 400, 'VALIDATION_ERROR');
  return maxImages;
}

function normalizeStringArray(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AppError('sourceItemIds must be an array of strings', 400, 'VALIDATION_ERROR');
  }
  return [...new Set(value.filter(Boolean))].sort();
}

function nullableString(value) {
  return value === undefined || value === null ? null : String(value).trim();
}

module.exports = { normalizeRequest };
