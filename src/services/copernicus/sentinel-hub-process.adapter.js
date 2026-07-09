const AppError = require('../../utils/app-error');
const env = require('../../config/env');
const { httpClient } = require('../../utils/http-client');
const CdseAuthService = require('./cdse-auth.service');
const EarthObservationProductRegistry = require('./earth-observation-product-registry');

class SentinelHubProcessAdapter {
  constructor(options = {}) {
    this.httpClient = options.httpClient || httpClient;
    this.authService = options.authService || new CdseAuthService({ httpClient: this.httpClient });
    this.productRegistry = options.productRegistry || new EarthObservationProductRegistry();
    this.processUrl = options.processUrl || env.copernicus.shProcessUrl;
    this.maxRetries = options.maxRetries || env.cdseMaxRetries;
  }

  async fetchImages(normalizedRequest) {
    const results = [];

    for (const imageKey of normalizedRequest.query.imageKeys) {
      const product = this.productRegistry.get(imageKey);
      const body = this.buildPayload(product, normalizedRequest.query);
      const response = await this.postProcess(body);
      const buffer = Buffer.from(response.data || '');

      results.push({
        imageKey,
        status: buffer.length > 0 ? 'available' : 'unavailable',
        contentType: response.headers ? response.headers['content-type'] || normalizedRequest.query.outputFormat : normalizedRequest.query.outputFormat,
        contentDisposition: response.headers ? response.headers['content-disposition'] : undefined,
        dataBase64: buffer.length > 0 ? buffer.toString('base64') : '',
        sizeBytes: buffer.length,
        requestedDate: normalizedRequest.query.date,
        actualDate: buffer.length > 0 ? normalizedRequest.query.date : 'N/A',
        collection: product.collectionLabel,
        message: buffer.length > 0 ? 'Image returned by Sentinel Hub Process API.' : 'Empty image response.',
        externalRequest: {
          method: 'POST',
          url: this.processUrl,
          body
        }
      });
    }

    return {
      rawData: results,
      externalRequest: {
        method: 'POST',
        url: this.processUrl,
        imageKeys: normalizedRequest.query.imageKeys
      },
      metadata: {
        source: normalizedRequest.source,
        mode: normalizedRequest.mode,
        responseProfile: normalizedRequest.responseProfile,
        bbox: normalizedRequest.query.bbox,
        tileName: normalizedRequest.query.tileName,
        requestedDate: normalizedRequest.query.date,
        queriedAt: new Date().toISOString()
      }
    };
  }

  buildPayload(product, query) {
    const from = `${query.date}T00:00:00Z`;
    const to = `${query.date}T23:59:59Z`;

    return {
      input: {
        bounds: {
          properties: { crs: query.crs || 'http://www.opengis.net/def/crs/OGC/1.3/CRS84' },
          bbox: query.bbox
        },
        data: product.dataSources.map((source) => ({
          ...(source.id ? { id: source.id } : {}),
          type: source.type,
          dataFilter: {
            timeRange: { from, to },
            ...(source.mosaickingOrder ? { mosaickingOrder: source.mosaickingOrder } : {}),
            ...(source.maxCloudCoverage !== undefined ? { maxCloudCoverage: source.maxCloudCoverage } : {})
          },
          processing: {
            upsampling: query.upsampling || 'BILINEAR',
            downsampling: query.downsampling || 'BILINEAR'
          }
        }))
      },
      output: {
        width: query.tileSize,
        height: query.tileSize,
        responses: [
          {
            identifier: 'default',
            format: { type: query.outputFormat || product.outputFormat }
          }
        ]
      },
      evalscript: product.evalscript
    };
  }

  async postProcess(body) {
    let lastResponse;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const token = await this.authService.getAccessToken({ forceRefresh: attempt > 1 && lastResponse && lastResponse.status === 401 });

      let response;
      try {
        response = await this.httpClient.post(this.processUrl, body, {
          timeout: env.cdseProcessTimeoutMs,
          responseType: 'arraybuffer',
          headers: {
            Accept: '*/*',
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

        throw new AppError(`Sentinel Hub process request failed: ${error.message}`, 502, 'EXTERNAL_PROVIDER_ERROR', {
          provider: 'sentinel-hub',
          retryable: true
        });
      }

      lastResponse = response;

      if (response.status >= 200 && response.status < 300) {
        if (!response.data || Buffer.from(response.data).length === 0) {
          throw new AppError('Sentinel Hub returned an empty image response', 502, 'EMPTY_PROVIDER_RESPONSE', {
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
    }

    throw new AppError(`Sentinel Hub process request failed with status ${lastResponse ? lastResponse.status : 'unknown'}`, 502, 'EXTERNAL_PROVIDER_ERROR', {
      provider: 'sentinel-hub',
      retryable: lastResponse ? lastResponse.status >= 500 || lastResponse.status === 429 : true
    });
  }
}

module.exports = SentinelHubProcessAdapter;

