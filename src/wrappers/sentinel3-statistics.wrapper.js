const BaseWrapper = require('./base.wrapper');
const AppError = require('../utils/app-error');

class Sentinel3StatisticsWrapper extends BaseWrapper {
  supports(context) {
    return context.source === 'copernicus'
      && context.mode === 'sentinel-hub-statistics'
      && context.responseProfile === 'sentinel-3-surface-temperature';
  }

  transform(rawData, metadata) {
    const intervals = Array.isArray(rawData && rawData.data) ? rawData.data : [];

    if (!Array.isArray(intervals)) {
      throw new AppError('Invalid Sentinel-3 statistics response schema', 502, 'INVALID_PROVIDER_RESPONSE', {
        provider: 'sentinel-hub',
        retryable: false
      });
    }

    return {
      data: intervals.map((interval) => this.transformInterval(interval)).filter(Boolean),
      metadata
    };
  }

  transformInterval(interval) {
    const date = interval && interval.interval && interval.interval.from
      ? String(interval.interval.from).slice(0, 10)
      : null;
    const mean = interval
      && interval.outputs
      && interval.outputs.data
      && interval.outputs.data.bands
      && interval.outputs.data.bands.B0
      && interval.outputs.data.bands.B0.stats
      && interval.outputs.data.bands.B0.stats.mean;

    if (!date || mean === undefined || mean === null || mean === 'NaN') {
      return null;
    }

    const kelvin = Number(mean);

    if (Number.isNaN(kelvin)) {
      return null;
    }

    return {
      date,
      metrics: {
        s3_surface_temperature: kelvin - 273.15
      }
    };
  }
}

module.exports = Sentinel3StatisticsWrapper;
