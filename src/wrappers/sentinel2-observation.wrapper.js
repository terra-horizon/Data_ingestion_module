const BaseWrapper = require('./base.wrapper');
const AppError = require('../utils/app-error');
const { METRICS, validateObservation, finiteOrNull } = require('../validation/water-quality-observation');

class Sentinel2ObservationWrapper extends BaseWrapper {
  supports(context) {
    return context.responseProfile === 'sentinel-2-observations'
      && context.source === 'copernicus'
      && context.mode === 'sentinel-hub-statistics'
      && context.datasetType === 'water-quality-observations'
      && context.format === 'json';
  }

  transform(rawData, metadata, context) {
    if (!rawData || !Array.isArray(rawData.data) || rawData.data.some((entry) => !this.dateOf(entry))) {
      throw new AppError('Copernicus statistics response has an invalid shape', 502, 'INVALID_SOURCE_RESPONSE', { retryable: false });
    }

    const intervals = new Map((rawData.data || []).map((entry) => [this.dateOf(entry), entry]));
    const observations = this.requestedDates(context.query.dateFrom, context.query.dateTo).map((date) => (
      this.toObservation(intervals.get(date), date, metadata, context)
    ));
    const validations = observations.map((observation) => ({
      tile_id: observation.tile_id,
      observation_date: observation.observation_date,
      ...validateObservation(observation)
    }));
    const invalid = validations.filter((result) => !result.valid);
    if (invalid.length) {
      throw new AppError('Normalized Sentinel-2 observations failed schema validation', 502, 'SCHEMA_VALIDATION_ERROR', {
        retryable: false,
        details: { validationErrors: invalid }
      });
    }

    const serializedSize = Buffer.byteLength(JSON.stringify(observations));
    const dates = observations.map((item) => item.observation_date);
    return {
      data: { observations },
      metadata: {
        type: 'water-quality-observations',
        ingestionRunId: context.operation.ingestionRunId,
        terminalStatus: 'success',
        requestedSources: [metadata.source],
        requestedInterval: { from: context.query.dateFrom, to: context.query.dateTo },
        acquiredDateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
        recordCount: observations.length,
        totalDataSizeBytes: serializedSize,
        mongo: { collections: [], changedEntryCounts: {} },
        minio: { bucket: null, objects: [] },
        validation: { valid: true, results: validations },
        warnings: [],
        retryableFailedUnits: [],
        schemaVersions: { observation: '1.0.0' },
        provider: metadata.source,
        mode: metadata.mode,
        collection: metadata.collection,
        completedAt: new Date().toISOString()
      }
    };
  }

  toObservation(interval, observationDate, metadata, context) {
    const stats = this.bandStats(interval);
    const metrics = this.calculateMetrics(stats.means);
    const missingMetrics = METRICS.some((metric) => metrics[metric] === null);
    const qualityFlags = [];
    if (missingMetrics) qualityFlags.push('missing_metrics');
    if (stats.validPixels === 0) qualityFlags.push('no_valid_pixels');

    return {
      schema_version: '1.0.0',
      ingestion_run_id: context.operation.ingestionRunId,
      aoi_id: context.query.aoiId,
      aoi_definition_hash: context.query.aoiDefinitionHash,
      tile_id: context.query.tileId,
      observation_date: observationDate,
      bbox: [...context.query.bbox],
      geometry_reference: context.query.geometryReference,
      collection_status: missingMetrics ? 'unavailable' : 'collected',
      collection_method: 'all_valid_pixels_v1',
      source_name: metadata.source,
      source_collection: metadata.collection,
      source_item_ids: [...context.query.sourceItemIds],
      source_scene_count: context.query.sourceItemIds.length,
      acquisition_timestamp: metadata.queriedAt,
      water_pct: null,
      cloud_pct: null,
      valid_pixels: stats.validPixels,
      water_status: 'unknown',
      water_check_status: 'not_performed',
      quality_flags: qualityFlags,
      artifact_refs: {},
      ...metrics
    };
  }

  bandStats(interval) {
    const bands = interval && interval.outputs && interval.outputs.data && interval.outputs.data.bands;
    if (!bands) return { means: null, validPixels: 0 };
    const bandStats = [0, 1, 2, 3, 4].map((index) => (bands[`B${index}`] || {}).stats || {});
    const means = bandStats.map((stats) => finiteOrNull(stats.mean));
    const sampleCount = finiteOrNull(bandStats[0].sampleCount) || 0;
    const noDataCount = finiteOrNull(bandStats[0].noDataCount) || 0;
    return {
      means: means.every((value) => value !== null) ? means : null,
      validPixels: Math.max(Math.trunc(sampleCount - noDataCount), 0)
    };
  }

  calculateMetrics(means) {
    if (!means) return Object.fromEntries(METRICS.map((metric) => [metric, null]));
    const [b01, b02, b03, b04, b08] = means;
    if ([b01, b02, b03, b04, b08].includes(0)) {
      return Object.fromEntries(METRICS.map((metric) => [metric, 0]));
    }
    return {
      CDOM: finiteOrNull(537 * Math.exp(-2.93 * b03 / b04)),
      Chl_a: finiteOrNull(4.26 * ((b03 / b01) ** 3.94)),
      Color: finiteOrNull(25366 * Math.exp(-4.53 * b03 / b04)),
      Cya: finiteOrNull(115530.31 * ((b03 * b04 / b02) ** 2.38)),
      DOC: finiteOrNull(432 * Math.exp(-2.24 * b03 / b04)),
      Turb: finiteOrNull(8.93 * (b03 / b01) - 6.39),
      WQI: finiteOrNull(((b02 + (b01 - b03)) - b08) / ((b02 + (b01 - b03)) + b08))
    };
  }

  dateOf(interval) {
    return interval && interval.interval && interval.interval.from ? String(interval.interval.from).slice(0, 10) : '';
  }

  requestedDates(from, to) {
    const dates = [];
    const cursor = new Date(`${String(from).slice(0, 10)}T00:00:00Z`);
    const end = new Date(`${String(to).slice(0, 10)}T00:00:00Z`);
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }
}

module.exports = Sentinel2ObservationWrapper;
