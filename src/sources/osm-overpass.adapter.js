const BaseSourceAdapter = require('./base-source.adapter');
const AppError = require('../utils/app-error');
const env = require('../config/env');
const { httpClient, normalizeHttpError } = require('../utils/http-client');

class OsmOverpassAdapter extends BaseSourceAdapter {
  constructor(options = {}) {
    super();
    this.config = options.config || env;
    this.client = options.client || httpClient;
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  getName() { return 'osm-overpass'; }

  async fetchRiverNetwork(aoi) {
    const query = this.buildQuery(aoi.bbox);
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt += 1) {
      try {
        const response = await this.client.post(this.config.osm.overpassUrl, query, {
          timeout: this.config.osm.timeoutMs,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          validateStatus: () => true
        });
        if (response.status >= 200 && response.status < 300) return this.normalize(response.data, aoi);
        if (![429, 500, 502, 503, 504].includes(response.status) || attempt === this.config.retryAttempts) {
          throw new AppError(`Overpass request failed with ${response.status}`, 502, 'EXTERNAL_API_ERROR', {
            retryable: [429, 500, 502, 503, 504].includes(response.status)
          });
        }
      } catch (error) {
        if (error instanceof AppError && (!error.retryable || attempt === this.config.retryAttempts)) throw error;
        if (attempt === this.config.retryAttempts) {
          const normalized = normalizeHttpError(error, 'Overpass river request failed');
          normalized.retryable = true;
          throw normalized;
        }
      }
      await this.sleep(this.config.retryBaseDelayMs * (2 ** (attempt - 1)));
    }
  }

  buildQuery([minLon, minLat, maxLon, maxLat]) {
    const bbox = `${minLat},${minLon},${maxLat},${maxLon}`;
    return `data=${encodeURIComponent(`[out:json][timeout:${Math.ceil(this.config.osm.timeoutMs / 1000)}];way["waterway"="river"](${bbox});out tags geom;`)}`;
  }

  normalize(raw, aoi) {
    if (!raw || !Array.isArray(raw.elements)) {
      throw new AppError('Overpass response has an invalid shape', 502, 'INVALID_SOURCE_RESPONSE');
    }
    const rivers = raw.elements
      .filter((element) => element.type === 'way' && Array.isArray(element.geometry))
      .map((element) => ({
        riverId: String(element.id),
        name: element.tags?.name || null,
        geometry: {
          type: 'LineString',
          coordinates: element.geometry
            .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
            .map((point) => [point.lon, point.lat])
        },
        tags: { waterway: element.tags?.waterway || 'river' }
      }))
      .filter((river) => river.geometry.coordinates.length >= 2);
    if (!rivers.length) throw new AppError('No river network was found for the AOI', 422, 'NO_RIVER_NETWORK');
    return {
      source: this.getName(),
      aoiId: aoi.aoiId,
      queriedAt: new Date().toISOString(),
      rivers
    };
  }
}

module.exports = OsmOverpassAdapter;
