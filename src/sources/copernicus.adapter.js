const axios = require('axios');
const BaseSourceAdapter = require('./base-source.adapter');
const env = require('../config/env');
const AppError = require('../utils/app-error');
const { httpClient, normalizeHttpError } = require('../utils/http-client');
const CdseAuthService = require('../services/copernicus/cdse-auth.service');
const SentinelHubStatisticsAdapter = require('../services/copernicus/sentinel-hub-statistics.adapter');
const WaterTileScreeningService = require('../services/copernicus/water-tile-screening.service');
const SentinelHubProcessAdapter = require('../services/copernicus/sentinel-hub-process.adapter');
const { validateCopernicusRequest } = require('../services/copernicus/copernicus-request-rules');

class CopernicusAdapter extends BaseSourceAdapter {
  constructor(options = {}) {
    super();
    this.httpClient = options.httpClient || httpClient;
    this.authService = options.authService || new CdseAuthService({ httpClient: this.httpClient });
    this.statisticsAdapter = options.statisticsAdapter || new SentinelHubStatisticsAdapter({
      httpClient: this.httpClient,
      authService: this.authService
    });
    this.waterTileScreeningService = options.waterTileScreeningService || new WaterTileScreeningService({
      statisticsAdapter: this.statisticsAdapter
    });
    this.processAdapter = options.processAdapter || new SentinelHubProcessAdapter({
      httpClient: this.httpClient,
      authService: this.authService
    });
  }

  getName() {
    return 'copernicus';
  }

  async healthCheck() {
    const response = await httpClient.get(env.copernicus.stacBaseUrl);

    return {
      source: this.getName(),
      healthy: response.status >= 200 && response.status < 300,
      mode: env.copernicus.apiMode,
      stacBaseUrl: env.copernicus.stacBaseUrl
    };
  }

  validateRequest(normalizedRequest) {
    validateCopernicusRequest(normalizedRequest);
  }

  buildExternalRequest(normalizedRequest) {
    if (normalizedRequest.mode === 'sentinel-hub-catalog') {
      return this.buildSentinelHubCatalogRequest(normalizedRequest);
    }

    if (normalizedRequest.mode === 'sentinel-hub-process') {
      return this.buildSentinelHubProcessRequest(normalizedRequest);
    }

    return this.buildStacRequest(normalizedRequest);
  }

  async fetchData(normalizedRequest) {
    this.validateRequest(normalizedRequest);

    const handler = this.getRequestHandler(normalizedRequest);

    try {
      return await handler(normalizedRequest);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw normalizeHttpError(error, `Copernicus ${normalizedRequest.mode} search failed`);
    }
  }

  getRequestHandler(normalizedRequest) {
    const key = `${normalizedRequest.mode}:${normalizedRequest.responseProfile}`;
    const handlers = {
      'sentinel-hub-statistics:water-tile-screening': (request) =>
        this.waterTileScreeningService.screenTiles(request),

      'sentinel-hub-statistics:water-quality-statistics': (request) =>
        this.statisticsAdapter.fetchStatistics(request),

      'sentinel-hub-statistics:sentinel-3-surface-temperature': (request) =>
        this.statisticsAdapter.fetchStatistics(request),

      'sentinel-hub-process:target-date-image': (request) =>
        this.processAdapter.fetchImages(request)
    };

    return handlers[key] || ((request) => this.fetchExternalRequest(request));
  }

  async fetchExternalRequest(normalizedRequest) {
    const externalRequest = this.buildExternalRequest(normalizedRequest);
    const response = await this.sendExternalRequest(normalizedRequest, externalRequest);
    const rawData = response.data;

    return {
      rawData,
      externalRequest,
      metadata: this.buildResponseMetadata(normalizedRequest, rawData, response)
    };
  }

  async sendExternalRequest(normalizedRequest, externalRequest) {
    if (normalizedRequest.mode === 'sentinel-hub-catalog') {
      return this.postSentinelHubCatalog(externalRequest);
    }

    if (normalizedRequest.mode === 'sentinel-hub-process') {
      return this.postSentinelHubProcess(externalRequest);
    }

    return httpClient.post(externalRequest.url, externalRequest.body, {
      headers: await this.buildHeaders()
    });
  }

  buildResponseMetadata(normalizedRequest, rawData, response) {
    return {
      source: this.getName(),
      mode: normalizedRequest.mode,
      collection: normalizedRequest.collection,
      returnedItems: Array.isArray(rawData.features) ? rawData.features.length : 1,
      contentType: response.headers ? response.headers['content-type'] : undefined,
      sizeBytes: Buffer.isBuffer(rawData) ? rawData.length : undefined,
      queriedAt: new Date().toISOString()
    };
  }

  extractMetadata(rawResponse) {
    return rawResponse.metadata;
  }

  buildStacRequest(normalizedRequest) {
    const body = {
      collections: [normalizedRequest.collection],
      limit: normalizedRequest.query.limit
    };

    if (normalizedRequest.query.bbox) {
      body.bbox = normalizedRequest.query.bbox;
    }

    if (normalizedRequest.query.dateFrom || normalizedRequest.query.dateTo) {
      body.datetime = this.toStacDatetime(normalizedRequest.query.dateFrom, normalizedRequest.query.dateTo);
    }

    if (normalizedRequest.query.cloudCoverageMax !== null && normalizedRequest.query.cloudCoverageMax !== undefined) {
      body.query = {
        'eo:cloud_cover': {
          lte: Number(normalizedRequest.query.cloudCoverageMax)
        }
      };
    }

    return {
      method: 'POST',
      url: `${env.copernicus.stacBaseUrl.replace(/\/$/, '')}/search`,
      body
    };
  }

  buildSentinelHubCatalogRequest(normalizedRequest) {
    return {
      method: 'POST',
      url: env.copernicus.shCatalogUrl,
      body: {
        bbox: normalizedRequest.query.bbox,
        datetime: this.toStacDatetime(normalizedRequest.query.dateFrom, normalizedRequest.query.dateTo),
        collections: [normalizedRequest.collection],
        limit: Math.min(100, Math.max(normalizedRequest.query.maxImages * 4, 40))
      }
    };
  }

  buildSentinelHubProcessRequest(normalizedRequest) {
    const scene = normalizedRequest.query.scene;
    const [from, to] = this.sceneTimeWindow(scene.datetime);
    const [width, height] = this.bboxDimensionsFor10m(normalizedRequest.query.bbox);

    return {
      method: 'POST',
      url: env.copernicus.shProcessUrl,
      body: {
        input: {
          bounds: {
            bbox: normalizedRequest.query.bbox,
            properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' }
          },
          data: [
            {
              type: normalizedRequest.collection,
              dataFilter: {
                timeRange: { from, to },
                mosaickingOrder: 'leastCC'
              }
            }
          ]
        },
        output: {
          responses: [
            {
              identifier: 'default',
              format: { type: 'image/tiff' }
            }
          ],
          width,
          height
        },
        evalscript: this.rawBandsEvalscript()
      },
      scene,
      width,
      height
    };
  }

  async buildHeaders() {
    const headers = {};

    if (env.copernicus.accessToken) {
      headers.Authorization = `Bearer ${env.copernicus.accessToken}`;
    }

    return headers;
  }

  async postSentinelHubCatalog(externalRequest) {
    return axios.post(externalRequest.url, externalRequest.body, {
      timeout: env.requestTimeoutMs,
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async postSentinelHubProcess(externalRequest) {
    const response = await axios.post(externalRequest.url, externalRequest.body, {
      timeout: 180000,
      responseType: 'arraybuffer',
      headers: {
        Authorization: `Bearer ${await this.getAccessToken()}`,
        'Content-Type': 'application/json',
        Accept: 'image/tiff'
      },
      validateStatus: () => true
    });

    if (response.status !== 200) {
      const snippet = Buffer.from(response.data || '').toString('utf8').slice(0, 500);
      throw new AppError(`CDSE process error ${response.status}: ${snippet}`, 502, 'EXTERNAL_API_ERROR');
    }

    return response;
  }

  async getAccessToken() {
    if (env.copernicus.accessToken) {
      return env.copernicus.accessToken;
    }

    if (!env.copernicus.clientId || !env.copernicus.clientSecret) {
      throw new AppError('sentinel-hub-catalog mode requires COPERNICUS_ACCESS_TOKEN or COPERNICUS_CLIENT_ID/COPERNICUS_CLIENT_SECRET', 503, 'COPERNICUS_AUTH_MISSING');
    }

    try {
      const form = new URLSearchParams();
      form.set('grant_type', 'client_credentials');
      form.set('client_id', env.copernicus.clientId);
      form.set('client_secret', env.copernicus.clientSecret);

      const response = await httpClient.post(env.copernicus.tokenUrl, form.toString(), {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (!response.data.access_token) {
        throw new AppError('Copernicus token response did not include access_token', 502, 'COPERNICUS_AUTH_ERROR');
      }

      return response.data.access_token;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw normalizeHttpError(error, 'Copernicus token request failed');
    }
  }

  toStacDatetime(dateFrom, dateTo) {
    const from = dateFrom ? `${dateFrom}T00:00:00Z` : '..';
    const to = dateTo ? `${dateTo}T23:59:59Z` : '..';

    return `${from}/${to}`;
  }

  sceneTimeWindow(sceneDatetime) {
    const timestamp = Date.parse(sceneDatetime);
    if (Number.isNaN(timestamp)) {
      throw new AppError('scene.datetime must be a valid date', 400, 'VALIDATION_ERROR');
    }

    const twelveHoursMs = 12 * 60 * 60 * 1000;
    return [
      new Date(timestamp - twelveHoursMs).toISOString().replace('.000Z', 'Z'),
      new Date(timestamp + twelveHoursMs).toISOString().replace('.000Z', 'Z')
    ];
  }

  bboxDimensionsFor10m(bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const lonSpan = Math.max(1e-8, Number(maxLon) - Number(minLon));
    const latSpan = Math.max(1e-8, Number(maxLat) - Number(minLat));
    const latMid = (Number(minLat) + Number(maxLat)) / 2.0;
    const cosLat = Math.max(Math.cos(latMid * Math.PI / 180), 0.1);
    const metersX = lonSpan * 111320.0 * cosLat;
    const metersY = latSpan * 110540.0;

    return [
      Math.min(Math.max(Math.ceil(metersX / 10.0), 64), 2500),
      Math.min(Math.max(Math.ceil(metersY / 10.0), 64), 2500)
    ];
  }

  rawBandsEvalscript() {
    return `//VERSION=3
      function setup() {
        return {
          input: [{ bands: ["B02", "B03", "B04", "B08", "B11"], units: "REFLECTANCE" }],
          output: { bands: 5, sampleType: "FLOAT32" }
        };
      }

      function evaluatePixel(sample) {
        return [sample.B02, sample.B03, sample.B04, sample.B08, sample.B11];
      }`;
  }
}

module.exports = CopernicusAdapter;
