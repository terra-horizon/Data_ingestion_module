const test = require('node:test');
const assert = require('node:assert/strict');
const CopernicusAdapter = require('../src/sources/copernicus.adapter');

function createAdapter() {
  return new CopernicusAdapter({
    authService: { getAccessToken: async () => 'token' },
    statisticsAdapter: {},
    waterTileScreeningService: {},
    processAdapter: {}
  });
}

function normalizedRequest(overrides = {}) {
  return {
    source: 'copernicus',
    mode: 'stac',
    collection: 'sentinel-2-l2a',
    datasetType: 'catalogue',
    format: 'json',
    responseProfile: 'standard',
    query: {
      bbox: [22.1, 39.4, 22.2, 39.5],
      dateFrom: '2025-01-01',
      dateTo: '2025-01-31',
      date: '2026-05-27',
      imageKeys: ['true_color'],
      scene: { datetime: '2025-01-01T10:00:00Z' },
      tiles: [{ name: 'tile_0', bbox: [22.1, 39.4, 22.2, 39.5] }]
    },
    options: {
      download: false
    },
    ...overrides,
    query: {
      bbox: [22.1, 39.4, 22.2, 39.5],
      dateFrom: '2025-01-01',
      dateTo: '2025-01-31',
      date: '2026-05-27',
      imageKeys: ['true_color'],
      scene: { datetime: '2025-01-01T10:00:00Z' },
      tiles: [{ name: 'tile_0', bbox: [22.1, 39.4, 22.2, 39.5] }],
      ...(overrides.query || {})
    },
    options: {
      download: false,
      ...(overrides.options || {})
    }
  };
}

function assertValid(request) {
  const adapter = createAdapter();

  assert.doesNotThrow(() => adapter.validateRequest(request));
}

function assertInvalid(request, code, messageIncludes = []) {
  const adapter = createAdapter();

  assert.throws(
    () => adapter.validateRequest(request),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, code);

      for (const expectedMessage of messageIncludes) {
        assert.match(error.message, new RegExp(expectedMessage));
      }

      return true;
    }
  );
}

test('Copernicus validation accepts stac standard profile', () => {
  assertValid(normalizedRequest());
});

test('Copernicus validation accepts stac copernicus-compatibility profile', () => {
  assertValid(normalizedRequest({ responseProfile: 'copernicus-compatibility' }));
});

test('Copernicus validation accepts stac scene-search-compatibility profile', () => {
  assertValid(normalizedRequest({ responseProfile: 'scene-search-compatibility' }));
});

test('Copernicus validation accepts sentinel-hub-catalog scene-search-compatibility requests', () => {
  assertValid(normalizedRequest({
    mode: 'sentinel-hub-catalog',
    responseProfile: 'scene-search-compatibility'
  }));
});

test('Copernicus validation accepts sentinel-hub-process scene-download-compatibility requests', () => {
  assertValid(normalizedRequest({
    mode: 'sentinel-hub-process',
    responseProfile: 'scene-download-compatibility'
  }));
});

test('Copernicus validation accepts sentinel-hub-process target-date-image requests', () => {
  assertValid(normalizedRequest({
    mode: 'sentinel-hub-process',
    responseProfile: 'target-date-image'
  }));
});

test('Copernicus validation accepts sentinel-hub-statistics water-quality-statistics requests', () => {
  assertValid(normalizedRequest({
    mode: 'sentinel-hub-statistics',
    responseProfile: 'water-quality-statistics'
  }));
});

test('Copernicus validation accepts sentinel-hub-statistics sentinel-3-surface-temperature requests', () => {
  assertValid(normalizedRequest({
    mode: 'sentinel-hub-statistics',
    responseProfile: 'sentinel-3-surface-temperature'
  }));
});

test('Copernicus validation accepts sentinel-hub-statistics water-tile-screening requests', () => {
  assertValid(normalizedRequest({
    mode: 'sentinel-hub-statistics',
    responseProfile: 'water-tile-screening'
  }));
});

test('Copernicus validation rejects unsupported modes', () => {
  assertInvalid(
    normalizedRequest({ mode: 'unknown-mode' }),
    'UNSUPPORTED_MODE',
    ['unknown-mode']
  );
});

test('Copernicus validation rejects unsupported profiles for a valid mode', () => {
  assertInvalid(
    normalizedRequest({
      mode: 'sentinel-hub-statistics',
      responseProfile: 'scene-search-compatibility'
    }),
    'UNSUPPORTED_PROFILE',
    ['sentinel-hub-statistics', 'scene-search-compatibility']
  );
});

test('Copernicus validation rejects download for stac', () => {
  assertInvalid(
    normalizedRequest({ options: { download: true } }),
    'DOWNLOAD_NOT_SUPPORTED'
  );
});

test('Copernicus validation rejects download for sentinel-hub-statistics', () => {
  assertInvalid(
    normalizedRequest({
      mode: 'sentinel-hub-statistics',
      responseProfile: 'water-quality-statistics',
      options: { download: true }
    }),
    'DOWNLOAD_NOT_SUPPORTED'
  );
});

test('Copernicus validation rejects missing scene for scene-download-compatibility', () => {
  assertInvalid(
    normalizedRequest({
      mode: 'sentinel-hub-process',
      responseProfile: 'scene-download-compatibility',
      query: { scene: null }
    }),
    'VALIDATION_ERROR',
    ['scene']
  );
});

test('Copernicus validation rejects missing imageKeys for target-date-image', () => {
  assertInvalid(
    normalizedRequest({
      mode: 'sentinel-hub-process',
      responseProfile: 'target-date-image',
      query: { imageKeys: undefined }
    }),
    'VALIDATION_ERROR',
    ['imageKeys']
  );
});

test('Copernicus validation rejects empty imageKeys for target-date-image', () => {
  assertInvalid(
    normalizedRequest({
      mode: 'sentinel-hub-process',
      responseProfile: 'target-date-image',
      query: { imageKeys: [] }
    }),
    'VALIDATION_ERROR',
    ['imageKeys']
  );
});

test('Copernicus validation rejects missing tiles for water-tile-screening', () => {
  assertInvalid(
    normalizedRequest({
      mode: 'sentinel-hub-statistics',
      responseProfile: 'water-tile-screening',
      query: { tiles: undefined }
    }),
    'VALIDATION_ERROR',
    ['tiles']
  );
});

test('Copernicus validation rejects empty tiles for water-tile-screening', () => {
  assertInvalid(
    normalizedRequest({
      mode: 'sentinel-hub-statistics',
      responseProfile: 'water-tile-screening',
      query: { tiles: [] }
    }),
    'VALIDATION_ERROR',
    ['tiles']
  );
});

test('Copernicus validation rejects missing bbox/dateFrom/dateTo for statistics profiles', () => {
  assertInvalid(
    normalizedRequest({
      mode: 'sentinel-hub-statistics',
      responseProfile: 'water-quality-statistics',
      query: {
        bbox: undefined,
        dateFrom: '',
        dateTo: null
      }
    }),
    'VALIDATION_ERROR',
    ['bbox', 'dateFrom', 'dateTo']
  );
});

test('Copernicus validation rejects missing bbox/dateFrom/dateTo for sentinel-hub-catalog', () => {
  assertInvalid(
    normalizedRequest({
      mode: 'sentinel-hub-catalog',
      responseProfile: 'scene-search-compatibility',
      query: {
        bbox: undefined,
        dateFrom: '',
        dateTo: null
      }
    }),
    'VALIDATION_ERROR',
    ['bbox', 'dateFrom', 'dateTo']
  );
});
