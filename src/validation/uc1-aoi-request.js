const { createHash } = require('node:crypto');
const AppError = require('../utils/app-error');

const UC1_MODE = 'aoi-water-quality';
const UC1_PROFILE = 'uc1-water-quality-aoi';

function isUc1Request(payload) {
  return payload && (
    String(payload.useCaseId || '').toLowerCase() === 'uc1-forecaster'
    || String(payload.mode || '').toLowerCase() === UC1_MODE
    || String(payload.responseProfile || '').toLowerCase() === UC1_PROFILE
  );
}

function normalizeUc1Request(payload, config) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('UC1 request body must be a JSON object', 400, 'INVALID_REQUEST');
  }
  const aoi = payload.aoi || {};
  const aoiId = String(aoi.aoiId || '').trim();
  if (!aoiId) throw new AppError('aoi.aoiId is required', 400, 'VALIDATION_ERROR');
  validateBbox(aoi.bbox);
  validateDate(payload.dateFrom, 'dateFrom');
  validateDate(payload.dateTo, 'dateTo');
  if (Date.parse(payload.dateFrom) > Date.parse(payload.dateTo)) {
    throw new AppError('dateFrom must be on or before dateTo', 400, 'VALIDATION_ERROR');
  }
  if (String(payload.mode || UC1_MODE).toLowerCase() !== UC1_MODE) {
    throw new AppError(`UC1 mode must be ${UC1_MODE}`, 400, 'UNSUPPORTED_MODE');
  }
  if (String(payload.responseProfile || UC1_PROFILE).toLowerCase() !== UC1_PROFILE) {
    throw new AppError(`UC1 responseProfile must be ${UC1_PROFILE}`, 400, 'VALIDATION_ERROR');
  }
  const options = {
    includeTiles: payload.options?.includeTiles !== false,
    includeSentinel2Statistics: payload.options?.includeSentinel2Statistics !== false,
    includeSentinel2Images: payload.options?.includeSentinel2Images === true,
    includeSentinel3: payload.options?.includeSentinel3 === true
  };
  const tile = {
    spacingM: positiveInteger(payload.tile?.spacingM ?? config.spacingM, 'tile.spacingM'),
    sizeM: positiveInteger(payload.tile?.sizeM ?? config.sizeM, 'tile.sizeM'),
    minRiverLengthM: nonNegativeNumber(payload.tile?.minRiverLengthM ?? config.minRiverLengthM, 'tile.minRiverLengthM'),
    maxTiles: positiveInteger(payload.tile?.maxTiles ?? config.maxTilesPerRun, 'tile.maxTiles')
  };
  const dayCount = Math.floor((Date.parse(payload.dateTo) - Date.parse(payload.dateFrom)) / 86400000) + 1;
  if (dayCount > config.maxDaysPerRun) {
    throw new AppError(`UC1 date interval exceeds ${config.maxDaysPerRun} days`, 400, 'LIMIT_EXCEEDED');
  }
  const aoiDefinition = { aoiId, name: aoi.name || aoiId, bbox: aoi.bbox, geometry: aoi.geometry || null, tile };
  const aoiDefinitionHash = hash(aoiDefinition);
  return {
    source: 'uc1',
    provider: String(payload.provider || 'uc1').toLowerCase(),
    useCaseId: 'uc1-forecaster',
    mode: UC1_MODE,
    collection: 'sentinel-2-l2a',
    datasetType: 'water-quality-observations',
    format: 'json',
    responseProfile: UC1_PROFILE,
    operation: {
      ingestionRunId: String(payload.ingestionRunId || payload.idempotencyKey || `uc1_${hash({ aoiDefinitionHash, dateFrom: payload.dateFrom, dateTo: payload.dateTo }).slice(0, 24)}`),
      requestedAt: new Date().toISOString()
    },
    aoi: { aoiId, name: aoi.name || aoiId, bbox: [...aoi.bbox], geometry: aoi.geometry || null, aoiDefinitionHash },
    query: {
      aoiId,
      aoiDefinitionHash,
      bbox: [...aoi.bbox],
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      cloudCoverageMax: cloudCoverage(payload.cloudCoverageMax),
      metrics: Array.isArray(payload.metrics) ? [...new Set(payload.metrics.map(String))].sort() : []
    },
    tile,
    options
  };
}

function validateBbox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    throw new AppError('aoi.bbox must contain four finite numbers', 400, 'VALIDATION_ERROR');
  }
  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3] || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90) {
    throw new AppError('aoi.bbox must be ordered EPSG:4326 coordinates', 400, 'VALIDATION_ERROR');
  }
}

function validateDate(value, field) {
  if (!value || Number.isNaN(Date.parse(value))) throw new AppError(`${field} must be a valid date`, 400, 'VALIDATION_ERROR');
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new AppError(`${field} must be a positive integer`, 400, 'VALIDATION_ERROR');
  return number;
}

function nonNegativeNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new AppError(`${field} must be non-negative`, 400, 'VALIDATION_ERROR');
  return number;
}

function cloudCoverage(value) {
  const number = Number(value ?? 30);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new AppError('cloudCoverageMax must be between 0 and 100', 400, 'VALIDATION_ERROR');
  return number;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

module.exports = { UC1_MODE, UC1_PROFILE, isUc1Request, normalizeUc1Request };
