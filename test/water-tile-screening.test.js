const test = require('node:test');
const assert = require('node:assert/strict');
const WaterTileScreeningService = require('../src/services/copernicus/water-tile-screening.service');
const WaterTileScreeningWrapper = require('../src/wrappers/water-tile-screening.wrapper');

test('WaterTileScreeningService builds SWBM statistics payload', () => {
  const service = new WaterTileScreeningService({
    statisticsAdapter: { postStatistics: async () => ({ data: {} }) }
  });

  const payload = service.buildTilePayload([22.1, 39.4, 22.2, 39.5], {
    dateFrom: '2025-01-01',
    dateTo: '2026-01-01',
    maxCloudCoverage: 30
  });

  assert.equal(payload.input.data[0].type, 'sentinel-2-l2a');
  assert.match(payload.aggregation.evalscript, /MNDWI_thr/);
});

test('WaterTileScreeningWrapper parses water and cloud statistics', () => {
  const wrapper = new WaterTileScreeningWrapper();
  const wrapped = wrapper.transform([
    {
      tile: { name: 'tile_0', bbox: [22.1, 39.4, 22.2, 39.5] },
      rawData: {
        data: [
          {
            interval: { from: '2025-01-14T00:00:00Z' },
            outputs: {
              eobrowserStats: {
                bands: {
                  B0: { stats: { sampleCount: 1000, noDataCount: 79, mean: 0.635 } },
                  B1: { stats: { mean: 0.081 } }
                }
              }
            }
          }
        ]
      }
    }
  ], {});

  assert.equal(wrapped.data[0].tileName, 'tile_0');
  assert.equal(wrapped.data[0].selected, true);
  assert.equal(wrapped.data[0].scenes[0].validPixels, 921);
  assert.equal(wrapped.data[0].scenes[0].waterPct, 63.5);
  assert.equal(Number(wrapped.data[0].scenes[0].cloudPct.toFixed(1)), 8.1);
});
