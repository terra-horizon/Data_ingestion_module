const AppError = require('../../utils/app-error');
const env = require('../../config/env');
const { httpClient } = require('../../utils/http-client');
const CdseAuthService = require('./cdse-auth.service');

const SENTINEL2_WATER_QUALITY_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{
      bands: [
        "B01",
        "B02",
        "B03",
        "B04",
        "B05",
        "B08",
        "SCL",
        "dataMask"
      ]
    }],
    output: [
      {
        id: "data",
        bands: 6
      },
      {
        id: "dataMask",
        bands: 1
      }
    ]
  }
}

function evaluatePixel(samples) {
  let waterMask = 0;
  if (samples.SCL == 6) {
    waterMask = 1;
  }

  return {
    data: [samples.B01, samples.B02, samples.B03, samples.B04, samples.B05, samples.B08],
    dataMask: [samples.dataMask * waterMask]
  }
}`;

const SENTINEL2_WATER_QUALITY_EVALSCRIPT_V2 = `//VERSION=3
function setup() {
  return {
    input: [{
      bands: [
        "B01",
        "B02",
        "B03",
        "B04",
        "B08",
        "SCL",
        "dataMask"
      ]
    }],
    output: [
      {
        id: "data",
        bands: 5
      },
      {
        id: "dataMask",
        bands: 1
      }
    ]
  }
}

function evaluatePixel(samples) {
  let mndvi = (samples.B02 - samples.B08)/(samples.B02 + samples.B08)

  var waterMask=0
  if (mndvi>=0){
    waterMask=1
  }

  return {
    data: [samples.B01, samples.B02, samples.B03, samples.B04, samples.B08],
    dataMask: [samples.dataMask * waterMask]
  }
}`;

const SENTINEL3_SURFACE_TEMPERATURE_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["S8", "dataMask"] }],
    output: [{ id: "data", bands: 1 }, { id: "dataMask", bands: 1 }]
  };
}

function evaluatePixel(sample) {
  if (sample.S8 < 270) {
    return { data: [sample.S8], dataMask: [0] };
  }
  return { data: [sample.S8], dataMask: [sample.dataMask] };
}`;

class SentinelHubStatisticsAdapter {
  constructor(options = {}) {
    this.httpClient = options.httpClient || httpClient;
    this.authService = options.authService || new CdseAuthService({ httpClient: this.httpClient });
    this.statisticsUrl = options.statisticsUrl || env.copernicus.shStatisticsUrl;
    this.maxRetries = options.maxRetries || env.cdseMaxRetries;
    this.retryDelayMs = options.retryDelayMs ?? env.cdseRateLimitRetryDelaySeconds * 1000;
  }

  buildWaterQualityPayload(query) {
    return this.buildPayload({
      bbox: query.bbox,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      collection: 'sentinel-2-l2a',
      maxCloudCoverage: query.maxCloudCoverage ?? 30,
      evalscript: this.waterQualityEvalscript(query.product)
    });
  }

  buildSentinel3Payload(query) {
    return {
      ...this.buildPayload({
        bbox: query.bbox,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
        collection: 'sentinel-3-slstr',
        maxCloudCoverage: 100,
        evalscript: SENTINEL3_SURFACE_TEMPERATURE_EVALSCRIPT
      }),
      output: {
        format: 'JSON',
        statistics: ['mean'],
        includeInvalidPixels: false
      }
    };
  }

  waterQualityEvalscript(product) {
    return String(product || '').toLowerCase() === 'se2waq2'
      ? SENTINEL2_WATER_QUALITY_EVALSCRIPT_V2
      : SENTINEL2_WATER_QUALITY_EVALSCRIPT;
  }

  buildPayload({ bbox, dateFrom, dateTo, collection, maxCloudCoverage, evalscript }) {
    return {
      input: {
        bounds: { bbox },
        data: [
          {
            type: collection,
            dataFilter: {
              timeRange: {
                from: `${dateFrom}T00:00:00Z`,
                to: `${dateTo}T23:59:59Z`
              },
              maxCloudCoverage
            }
          }
        ]
      },
      aggregation: {
        timeRange: {
          from: `${dateFrom}T00:00:00Z`,
          to: `${dateTo}T23:59:59Z`
        },
        aggregationInterval: { of: 'P1D' },
        evalscript
      }
    };
  }

  async fetchStatistics(normalizedRequest) {
    const externalRequest = this.buildExternalRequest(normalizedRequest);
    const response = await this.postStatistics(externalRequest.body);

    return {
      rawData: response.data,
      externalRequest,
      metadata: {
        source: normalizedRequest.source,
        mode: normalizedRequest.mode,
        responseProfile: normalizedRequest.responseProfile,
        collection: externalRequest.collection,
        bbox: normalizedRequest.query.bbox,
        dateFrom: normalizedRequest.query.dateFrom,
        dateTo: normalizedRequest.query.dateTo,
        queriedAt: new Date().toISOString()
      }
    };
  }

  buildExternalRequest(normalizedRequest) {
    if (normalizedRequest.responseProfile === 'sentinel-3-surface-temperature') {
      return {
        method: 'POST',
        url: this.statisticsUrl,
        collection: 'sentinel-3-slstr',
        body: this.buildSentinel3Payload(normalizedRequest.query)
      };
    }

    return {
      method: 'POST',
      url: this.statisticsUrl,
      collection: 'sentinel-2-l2a',
      body: this.buildWaterQualityPayload(normalizedRequest.query)
    };
  }

  async postStatistics(body) {
    return this.postWithAuth(this.statisticsUrl, body, env.cdseStatisticsTimeoutMs, 'Sentinel Hub statistics request failed');
  }

  async postWithAuth(url, body, timeout, fallbackMessage) {
    let lastResponse;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const token = await this.authService.getAccessToken({ forceRefresh: attempt > 1 && lastResponse && lastResponse.status === 401 });

      let response;
      try {
        response = await this.httpClient.post(url, body, {
          timeout,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          validateStatus: () => true
        });
      } catch (error) {
        if (error.code === 'ECONNABORTED') {
          throw new AppError('Sentinel Hub request timed out.', 504, 'EXTERNAL_PROVIDER_TIMEOUT', {
            provider: 'sentinel-hub',
            retryable: true
          });
        }

        throw new AppError(`${fallbackMessage}: ${error.message}`, 502, 'EXTERNAL_PROVIDER_ERROR', {
          provider: 'sentinel-hub',
          retryable: true
        });
      }

      lastResponse = response;

      if (response.status >= 200 && response.status < 300) {
        if (!response.data) {
          throw new AppError('Sentinel Hub returned an empty response', 502, 'EMPTY_PROVIDER_RESPONSE', {
            provider: 'sentinel-hub',
            retryable: true
          });
        }

        return response;
      }

      if (response.status === 401) {
        this.authService.clearCurrentToken();
        continue;
      }

      if ((response.status === 403 || response.status === 429) && this.authService.rotateCredential()) {
        continue;
      }

      if (response.status === 429 && attempt < this.maxRetries && this.retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
        continue;
      }

      break;
    }

    throw new AppError(`${fallbackMessage}: provider returned ${lastResponse ? lastResponse.status : 'no response'}`, 502, 'EXTERNAL_PROVIDER_ERROR', {
      provider: 'sentinel-hub',
      retryable: lastResponse ? lastResponse.status >= 500 || lastResponse.status === 429 : true
    });
  }
}

SentinelHubStatisticsAdapter.SENTINEL2_WATER_QUALITY_EVALSCRIPT = SENTINEL2_WATER_QUALITY_EVALSCRIPT;
SentinelHubStatisticsAdapter.SENTINEL2_WATER_QUALITY_EVALSCRIPT_V2 = SENTINEL2_WATER_QUALITY_EVALSCRIPT_V2;
SentinelHubStatisticsAdapter.SENTINEL3_SURFACE_TEMPERATURE_EVALSCRIPT = SENTINEL3_SURFACE_TEMPERATURE_EVALSCRIPT;

module.exports = SentinelHubStatisticsAdapter;
