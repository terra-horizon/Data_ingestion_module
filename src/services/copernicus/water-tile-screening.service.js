const SentinelHubStatisticsAdapter = require('./sentinel-hub-statistics.adapter');

const SWBM_EVALSCRIPT = `//VERSION=3
var MNDWI_thr = 0.1;
var NDWI_thr = 0.2;
var SWI_thr = 0.03;

function setup() {
  return {
    input: [{
      bands: ["B02", "B03", "B04", "B05", "B08", "B11", "SCL", "dataMask"]
    }],
    output: [
      { id: "eobrowserStats", bands: 2, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}

function isCloud(scl) {
  return [8, 9].includes(scl);
}

function evaluatePixel(p) {
  let mndwi = index(p.B03, p.B11);
  let ndwi = index(p.B03, p.B08);
  let swi = index(p.B05, p.B11);
  let cloud = isCloud(p.SCL);
  let water = (!cloud && (mndwi > MNDWI_thr || ndwi > NDWI_thr || swi > SWI_thr)) ? 1 : 0;

  return {
    eobrowserStats: [water, cloud ? 1 : 0],
    dataMask: [p.dataMask]
  };
}`;

class WaterTileScreeningService {
  constructor(options = {}) {
    this.statisticsAdapter = options.statisticsAdapter || new SentinelHubStatisticsAdapter(options);
  }

  async screenTiles(normalizedRequest) {
    const tiles = normalizedRequest.query.tiles;
    const results = [];

    for (const tile of tiles) {
      const body = this.buildTilePayload(tile.bbox, normalizedRequest.query);
      const response = await this.statisticsAdapter.postStatistics(body);
      results.push({
        tile,
        rawData: response.data,
        externalRequest: {
          method: 'POST',
          url: this.statisticsAdapter.statisticsUrl,
          body
        }
      });
    }

    return {
      rawData: results,
      externalRequest: {
        method: 'POST',
        url: this.statisticsAdapter.statisticsUrl,
        tileCount: tiles.length
      },
      metadata: {
        source: normalizedRequest.source,
        mode: normalizedRequest.mode,
        responseProfile: normalizedRequest.responseProfile,
        dateFrom: normalizedRequest.query.dateFrom,
        dateTo: normalizedRequest.query.dateTo,
        maxCloudCoverage: normalizedRequest.query.maxCloudCoverage,
        tileCount: tiles.length,
        queriedAt: new Date().toISOString()
      }
    };
  }

  buildTilePayload(bbox, query) {
    return {
      input: {
        bounds: { bbox },
        data: [
          {
            type: 'sentinel-2-l2a',
            dataFilter: {
              timeRange: {
                from: `${query.dateFrom}T00:00:00Z`,
                to: `${query.dateTo}T23:59:59Z`
              },
              maxCloudCoverage: query.maxCloudCoverage ?? 30
            }
          }
        ]
      },
      aggregation: {
        timeRange: {
          from: `${query.dateFrom}T00:00:00Z`,
          to: `${query.dateTo}T23:59:59Z`
        },
        aggregationInterval: { of: 'P1D' },
        evalscript: SWBM_EVALSCRIPT
      }
    };
  }
}

WaterTileScreeningService.SWBM_EVALSCRIPT = SWBM_EVALSCRIPT;

module.exports = WaterTileScreeningService;
