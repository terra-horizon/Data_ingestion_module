const BaseSourceAdapter = require('./base-source.adapter');
const CopernicusAuth = require('./copernicus-auth');
const env = require('../config/env');
const AppError = require('../utils/app-error');
const { httpClient, normalizeHttpError } = require('../utils/http-client');

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

class CopernicusAdapter extends BaseSourceAdapter {
  constructor(options = {}) {
    super();
    this.config = options.config || env;
    this.client = options.client || httpClient;
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.auth = options.auth || new CopernicusAuth({ config: this.config.copernicus, client: this.client });
  }

  getName() { return 'copernicus'; }

  async healthCheck() {
    const response = await this.client.get(this.config.copernicus.stacBaseUrl);
    return {
      source: this.getName(),
      healthy: response.status >= 200 && response.status < 300,
      mode: this.config.copernicus.apiMode,
      stacBaseUrl: this.config.copernicus.stacBaseUrl
    };
  }

  validateRequest(request) {
    const modes = ['stac', 'sentinel-hub-catalog', 'sentinel-hub-process', 'sentinel-hub-statistics'];
    if (!modes.includes(request.mode)) {
      throw new AppError(`Copernicus mode must be one of: ${modes.join(', ')}`, 400, 'UNSUPPORTED_MODE');
    }
    if (request.options.download && request.mode !== 'sentinel-hub-process') {
      throw new AppError('Product downloads are only supported in sentinel-hub-process mode', 400, 'DOWNLOAD_NOT_SUPPORTED');
    }
    if (request.mode === 'sentinel-hub-process' && !request.query.scene) {
      throw new AppError('sentinel-hub-process mode requires requestParams.scene', 400, 'VALIDATION_ERROR');
    }
    if (['sentinel-hub-catalog', 'sentinel-hub-process', 'sentinel-hub-statistics'].includes(request.mode) && !request.query.bbox) {
      throw new AppError(`${request.mode} requires requestParams.bbox`, 400, 'VALIDATION_ERROR');
    }
  }

  buildExternalRequest(request) {
    if (request.mode === 'sentinel-hub-catalog') return this.buildSentinelHubCatalogRequest(request);
    if (request.mode === 'sentinel-hub-process') return this.buildSentinelHubProcessRequest(request);
    if (request.mode === 'sentinel-hub-statistics') return this.buildSentinelHubStatisticsRequest(request);
    return this.buildStacRequest(request);
  }

  async fetchData(request) {
    this.validateRequest(request);
    const externalRequest = this.buildExternalRequest(request);

    try {
      let response;
      if (request.mode === 'stac') response = await this.fetchStacPages(externalRequest);
      else response = await this.postAuthenticated(externalRequest, request.mode === 'sentinel-hub-process' ? 'arraybuffer' : 'json');

      const rawData = response.data;
      return {
        rawData,
        externalRequest,
        metadata: {
          source: this.getName(),
          mode: request.mode,
          collection: request.collection,
          returnedItems: Array.isArray(rawData.features) ? rawData.features.length : Array.isArray(rawData.data) ? rawData.data.length : 1,
          contentType: response.headers ? response.headers['content-type'] : undefined,
          sizeBytes: Buffer.isBuffer(rawData) ? rawData.length : Buffer.byteLength(JSON.stringify(rawData || null)),
          queriedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw normalizeHttpError(error, `Copernicus ${request.mode} request failed`);
    }
  }

  extractMetadata(rawResponse) { return rawResponse.metadata; }

  buildStacRequest(request) {
    const body = { collections: [request.collection], limit: request.query.limit };
    if (request.query.bbox) body.bbox = request.query.bbox;
    if (request.query.dateFrom || request.query.dateTo) body.datetime = this.toStacDatetime(request.query.dateFrom, request.query.dateTo);
    if (request.query.cloudCoverageMax !== null) body.query = { 'eo:cloud_cover': { lte: request.query.cloudCoverageMax } };
    return { method: 'POST', url: `${this.config.copernicus.stacBaseUrl.replace(/\/$/, '')}/search`, body };
  }

  buildSentinelHubCatalogRequest(request) {
    const body = {
      bbox: request.query.bbox,
      datetime: this.toStacDatetime(request.query.dateFrom, request.query.dateTo),
      collections: [request.collection],
      limit: Math.min(100, Math.max(request.query.maxImages * 4, 40))
    };
    if (request.query.cloudCoverageMax !== null) body.filter = `eo:cloud_cover <= ${request.query.cloudCoverageMax}`;
    return { method: 'POST', url: this.config.copernicus.shCatalogUrl, body };
  }

  buildSentinelHubStatisticsRequest(request) {
    return {
      method: 'POST',
      url: this.config.copernicus.shStatisticsUrl,
      body: {
        input: {
          bounds: {
            bbox: request.query.bbox,
            properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' }
          },
          data: [{
            type: request.collection,
            dataFilter: {
              timeRange: {
                from: this.startOfDay(request.query.dateFrom),
                to: this.endOfDay(request.query.dateTo)
              },
              ...(request.query.cloudCoverageMax !== null ? { maxCloudCoverage: request.query.cloudCoverageMax } : {})
            }
          }]
        },
        aggregation: {
          timeRange: {
            from: this.startOfDay(request.query.dateFrom),
            to: this.endOfDay(request.query.dateTo)
          },
          aggregationInterval: { of: 'P1D' },
          evalscript: this.statisticsEvalscript()
        }
      }
    };
  }

  buildSentinelHubProcessRequest(request) {
    const scene = request.query.scene;
    const [from, to] = this.sceneTimeWindow(scene.datetime);
    const [width, height] = this.bboxDimensionsFor10m(request.query.bbox);
    return {
      method: 'POST',
      url: this.config.copernicus.shProcessUrl,
      body: {
        input: {
          bounds: { bbox: request.query.bbox, properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' } },
          data: [{ type: request.collection, dataFilter: { timeRange: { from, to }, mosaickingOrder: 'leastCC' } }]
        },
        output: { responses: [{ identifier: 'default', format: { type: 'image/tiff' } }], width, height },
        evalscript: this.rawBandsEvalscript()
      },
      scene,
      width,
      height
    };
  }

  async fetchStacPages(initialRequest) {
    let current = initialRequest;
    const features = [];
    let lastResponse = null;
    const seen = new Set();

    while (current) {
      const requestKey = JSON.stringify([current.method, current.url, current.body || null]);
      if (seen.has(requestKey)) break;
      seen.add(requestKey);
      lastResponse = await this.requestWithRetry(current, false);
      const body = lastResponse.data || {};
      features.push(...(Array.isArray(body.features) ? body.features : []));
      const next = (body.links || []).find((link) => link.rel === 'next' && link.href);
      current = next ? {
        method: String(next.method || 'GET').toUpperCase(),
        url: next.href,
        body: next.body || undefined
      } : null;
    }

    return {
      ...lastResponse,
      data: { ...(lastResponse ? lastResponse.data : {}), features, links: [] }
    };
  }

  async postAuthenticated(request, responseType) {
    let retryAttempt = 1;
    let forceRefresh = false;
    let requestCount = 0;
    const credentialCount = Math.max(this.config.copernicus.credentialSets.length, 1);
    const requestLimit = this.config.retryAttempts * (credentialCount + 2);

    while (retryAttempt <= this.config.retryAttempts && requestCount < requestLimit) {
      requestCount += 1;
      const token = await this.auth.getAccessToken({ forceRefresh });
      forceRefresh = false;
      let response;
      try {
        response = await this.client.request({
          method: request.method,
          url: request.url,
          data: request.body,
          timeout: request.url === this.config.copernicus.shProcessUrl ? 180000 : this.config.requestTimeoutMs,
          responseType,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: responseType === 'arraybuffer' ? 'image/tiff' : 'application/json'
          },
          validateStatus: () => true
        });
      } catch (error) {
        if (retryAttempt === this.config.retryAttempts) throw normalizeHttpError(error, 'Copernicus request failed');
        await this.waitBeforeRetry(retryAttempt);
        retryAttempt += 1;
        continue;
      }

      if (response.status >= 200 && response.status < 300) return response;
      if (response.status === 401) {
        this.auth.invalidateCurrentToken();
        forceRefresh = true;
        continue;
      }
      if ((response.status === 403 || response.status === 429) && this.auth.moveToNextCredential()) {
        continue;
      }
      if (RETRYABLE_STATUSES.has(response.status) && retryAttempt < this.config.retryAttempts) {
        await this.waitBeforeRetry(retryAttempt, response.headers && response.headers['retry-after']);
        retryAttempt += 1;
        continue;
      }
      throw this.externalStatusError(response, request.url);
    }

    throw new AppError('Copernicus request exhausted its retry budget', 502, 'EXTERNAL_API_ERROR', { retryable: true });
  }

  async requestWithRetry(request) {
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt += 1) {
      let response;
      try {
        response = await this.client.request({
          method: request.method,
          url: request.url,
          data: request.body,
          timeout: this.config.requestTimeoutMs,
          validateStatus: () => true
        });
      } catch (error) {
        if (attempt === this.config.retryAttempts) throw normalizeHttpError(error, 'Copernicus STAC request failed');
        await this.waitBeforeRetry(attempt);
        continue;
      }
      if (response.status >= 200 && response.status < 300) return response;
      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.config.retryAttempts) {
        await this.waitBeforeRetry(attempt, response.headers && response.headers['retry-after']);
        continue;
      }
      throw this.externalStatusError(response, request.url);
    }
  }

  externalStatusError(response, url) {
    const detail = response.data && (response.data.message || response.data.error || response.data.detail);
    return new AppError(
      `Copernicus request failed with ${response.status}${detail ? `: ${detail}` : ''}`,
      502,
      'EXTERNAL_API_ERROR',
      { retryable: RETRYABLE_STATUSES.has(response.status), details: { externalStatus: response.status, url } }
    );
  }

  async waitBeforeRetry(attempt, retryAfter) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) && seconds >= 0
      ? Math.min(seconds * 1000, 60000)
      : this.config.retryBaseDelayMs * (2 ** (attempt - 1));
    await this.sleep(delay);
  }

  toStacDatetime(from, to) { return `${from ? this.startOfDay(from) : '..'}/${to ? this.endOfDay(to) : '..'}`; }
  startOfDay(value) { return `${String(value).slice(0, 10)}T00:00:00Z`; }
  endOfDay(value) { return `${String(value).slice(0, 10)}T23:59:59Z`; }

  sceneTimeWindow(sceneDatetime) {
    const timestamp = Date.parse(sceneDatetime);
    if (Number.isNaN(timestamp)) throw new AppError('scene.datetime must be a valid date', 400, 'VALIDATION_ERROR');
    const twelveHours = 12 * 60 * 60 * 1000;
    return [new Date(timestamp - twelveHours).toISOString().replace('.000Z', 'Z'), new Date(timestamp + twelveHours).toISOString().replace('.000Z', 'Z')];
  }

  bboxDimensionsFor10m(bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const cosLat = Math.max(Math.cos(((minLat + maxLat) / 2) * Math.PI / 180), 0.1);
    return [
      Math.min(Math.max(Math.ceil((maxLon - minLon) * 111320 * cosLat / 10), 64), 2500),
      Math.min(Math.max(Math.ceil((maxLat - minLat) * 110540 / 10), 64), 2500)
    ];
  }

  statisticsEvalscript() {
    return `//VERSION=3
      function setup() {
        return {
          input: [{ bands: ["B01", "B02", "B03", "B04", "B08", "dataMask"] }],
          output: [{ id: "data", bands: 5 }, { id: "dataMask", bands: 1 }]
        };
      }
      function evaluatePixel(sample) {
        return { data: [sample.B01, sample.B02, sample.B03, sample.B04, sample.B08], dataMask: [sample.dataMask] };
      }`;
  }

  rawBandsEvalscript() {
    return `//VERSION=3
      function setup() {
        return { input: [{ bands: ["B02", "B03", "B04", "B08", "B11"], units: "REFLECTANCE" }], output: { bands: 5, sampleType: "FLOAT32" } };
      }
      function evaluatePixel(sample) { return [sample.B02, sample.B03, sample.B04, sample.B08, sample.B11]; }`;
  }
}

module.exports = CopernicusAdapter;
