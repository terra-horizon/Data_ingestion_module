const BaseWrapper = require('./base.wrapper');
const AppError = require('../utils/app-error');

class Sentinel2StatisticsWrapper extends BaseWrapper {
  supports(context) {
    return context.source === 'copernicus'
      && context.mode === 'sentinel-hub-statistics'
      && context.responseProfile === 'water-quality-statistics';
  }

  transform(rawData, metadata) {
    const intervals = Array.isArray(rawData && rawData.data) ? rawData.data : [];

    if (!Array.isArray(intervals)) {
      throw new AppError('Invalid Sentinel-2 statistics response schema', 502, 'INVALID_PROVIDER_RESPONSE', {
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
    const bands = interval && interval.outputs && interval.outputs.data && interval.outputs.data.bands;

    if (!date || !bands) {
      return null;
    }

    const metrics = this.metricsFromBands(bands, 'mean');

    if (!metrics) {
      return null;
    }

    return {
      date,
      metrics
    };
  }

  metricsFromBands(bands, statName) {
    const values = ['B0', 'B1', 'B2', 'B3', 'B4'].map((bandName) => {
      const value = bands[bandName] && bands[bandName].stats && bands[bandName].stats[statName];
      return value === undefined || value === null || value === 'NaN' ? null : Number(value);
    });

    if (values.some((value) => value === null || Number.isNaN(value))) {
      return null;
    }

    const [b01, b02, b03, b04, b05] = values;

    if ([b01, b02, b03, b04, b05].some((value) => value === 0)) {
      return {
        Chl_a: 0,
        Cya: 0,
        Turb: 0,
        CDOM: 0,
        DOC: 0,
        Color: 0,
        WQI: 0
      };
    }

    return {
      Chl_a: 4.26 * (b03 / b01) ** 3.94,
      Cya: 115530.31 * ((b03 * b04) / b02) ** 2.38,
      Turb: 8.93 * (b03 / b01) - 6.39,
      CDOM: 537 * Math.exp((-2.93 * b03) / b04),
      DOC: 432 * Math.exp((-2.24 * b03) / b04),
      Color: 25366 * Math.exp((-4.53 * b03) / b04),
      WQI: ((b02 + (b01 - b03)) - b05) / ((b02 + (b01 - b03)) + b05)
    };
  }
}

module.exports = Sentinel2StatisticsWrapper;
