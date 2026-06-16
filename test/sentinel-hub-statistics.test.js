const test = require('node:test');
const assert = require('node:assert/strict');
const SentinelHubStatisticsAdapter = require('../src/services/copernicus/sentinel-hub-statistics.adapter');
const Sentinel2StatisticsWrapper = require('../src/wrappers/sentinel2-statistics.wrapper');
const Sentinel3StatisticsWrapper = require('../src/wrappers/sentinel3-statistics.wrapper');

test('SentinelHubStatisticsAdapter builds Sentinel-2 statistics payload', () => {
  const adapter = new SentinelHubStatisticsAdapter({
    authService: { getAccessToken: async () => 'token' },
    httpClient: { post: async () => ({ status: 200, data: {} }) }
  });

  const payload = adapter.buildWaterQualityPayload({
    bbox: [22.1, 39.4, 22.8, 40.1],
    dateFrom: '2025-01-01',
    dateTo: '2025-01-31',
    maxCloudCoverage: 30
  });

  assert.equal(payload.input.data[0].type, 'sentinel-2-l2a');
  assert.deepEqual(payload.input.bounds.bbox, [22.1, 39.4, 22.8, 40.1]);
  assert.equal(payload.input.data[0].dataFilter.timeRange.from, '2025-01-01T00:00:00Z');
  assert.equal(payload.aggregation.aggregationInterval.of, 'P1D');
});

test('SentinelHubStatisticsAdapter builds Sentinel-3 statistics payload', () => {
  const adapter = new SentinelHubStatisticsAdapter({
    authService: { getAccessToken: async () => 'token' },
    httpClient: { post: async () => ({ status: 200, data: {} }) }
  });

  const payload = adapter.buildSentinel3Payload({
    bbox: [22.1, 39.4, 22.8, 40.1],
    dateFrom: '2025-01-01',
    dateTo: '2025-01-31'
  });

  assert.equal(payload.input.data[0].type, 'sentinel-3-slstr');
  assert.deepEqual(payload.output.statistics, ['mean']);
});

test('Sentinel2StatisticsWrapper parses water quality metrics', () => {
  const wrapper = new Sentinel2StatisticsWrapper();
  const wrapped = wrapper.transform({
    data: [
      {
        interval: { from: '2025-01-01T00:00:00Z' },
        outputs: {
          data: {
            bands: {
              B0: { stats: { mean: 0.1 } },
              B1: { stats: { mean: 0.2 } },
              B2: { stats: { mean: 0.3 } },
              B3: { stats: { mean: 0.4 } },
              B4: { stats: { mean: 0.5 } }
            }
          }
        }
      }
    ]
  }, { collection: 'sentinel-2-l2a' });

  assert.equal(wrapped.data[0].date, '2025-01-01');
  assert.equal(typeof wrapped.data[0].metrics.Chl_a, 'number');
  assert.equal(typeof wrapped.data[0].metrics.WQI, 'number');
});

test('Sentinel3StatisticsWrapper converts Kelvin to Celsius', () => {
  const wrapper = new Sentinel3StatisticsWrapper();
  const wrapped = wrapper.transform({
    data: [
      {
        interval: { from: '2025-01-01T00:00:00Z' },
        outputs: {
          data: {
            bands: {
              B0: { stats: { mean: 291.57 } }
            }
          }
        }
      }
    ]
  }, {});

  assert.equal(wrapped.data[0].date, '2025-01-01');
  assert.equal(Number(wrapped.data[0].metrics.s3_surface_temperature.toFixed(2)), 18.42);
});
