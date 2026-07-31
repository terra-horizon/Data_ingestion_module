const METRICS = Object.freeze(['CDOM', 'Chl_a', 'Color', 'Cya', 'DOC', 'Turb', 'WQI']);
const COLLECTION_STATUSES = new Set(['collected', 'unavailable']);
const WATER_STATUSES = new Set(['water', 'no_water', 'unknown']);
const WATER_CHECK_STATUSES = new Set(['not_performed', 'evaluated']);

function validateObservation(observation) {
  const errors = [];
  const requiredStrings = [
    'schema_version', 'ingestion_run_id', 'aoi_id', 'aoi_definition_hash', 'tile_id',
    'observation_date', 'collection_status', 'collection_method', 'source_name',
    'acquisition_timestamp', 'water_status', 'water_check_status'
  ];
  for (const field of requiredStrings) {
    if (typeof observation[field] !== 'string' || !observation[field]) errors.push(`${field} must be a non-empty string`);
  }
  if (!Array.isArray(observation.bbox) || observation.bbox.length !== 4 || !observation.bbox.every(Number.isFinite)) {
    errors.push('bbox must contain four finite numbers');
  }
  if (!COLLECTION_STATUSES.has(observation.collection_status)) errors.push('collection_status is invalid');
  if (!WATER_STATUSES.has(observation.water_status)) errors.push('water_status is invalid');
  if (!WATER_CHECK_STATUSES.has(observation.water_check_status)) errors.push('water_check_status is invalid');
  if (!Number.isInteger(observation.valid_pixels) || observation.valid_pixels < 0) errors.push('valid_pixels must be a non-negative integer');
  if (!Array.isArray(observation.source_item_ids) || observation.source_item_ids.some((value) => typeof value !== 'string')) {
    errors.push('source_item_ids must be an array of strings');
  }
  for (const metric of METRICS) {
    if (observation[metric] !== null && !Number.isFinite(observation[metric])) errors.push(`${metric} must be finite or null`);
  }
  for (const field of ['water_pct', 'cloud_pct']) {
    if (observation[field] !== null && !Number.isFinite(observation[field])) errors.push(`${field} must be finite or null`);
  }
  return { valid: errors.length === 0, errors };
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '' || value === 'NaN') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

module.exports = { METRICS, validateObservation, finiteOrNull };
