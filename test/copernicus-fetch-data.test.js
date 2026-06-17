const test = require('node:test');
const assert = require('node:assert/strict');
const AppError = require('../src/utils/app-error');
const CopernicusAdapter = require('../src/sources/copernicus.adapter');

function createAdapter(overrides = {}) {
  return new CopernicusAdapter({
    authService: { getAccessToken: async () => 'token' },
    statisticsAdapter: {
      fetchStatistics: async () => ({ routedTo: 'statistics' })
    },
    waterTileScreeningService: {
      screenTiles: async () => ({ routedTo: 'water-tile-screening' })
    },
    processAdapter: {
      fetchImages: async () => ({ routedTo: 'process-images' })
    },
    ...overrides
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
      tiles: [{ name: 'tile_0', bbox: [22.1, 39.4, 22.2, 39.5] }],
      limit: 10
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
      limit: 10,
      ...(overrides.query || {})
    },
    options: {
      download: false,
      ...(overrides.options || {})
    }
  };
}

test('Copernicus fetchData validates before execution', async () => {
  const adapter = createAdapter();
  let validated = false;

  adapter.validateRequest = () => {
    validated = true;
  };
  adapter.fetchExternalRequest = async () => {
    assert.equal(validated, true);
    return { routedTo: 'external' };
  };

  const result = await adapter.fetchData(normalizedRequest());

  assert.deepEqual(result, { routedTo: 'external' });
});

test('Copernicus fetchData routes water-tile-screening to waterTileScreeningService', async () => {
  let called = false;
  const adapter = createAdapter({
    waterTileScreeningService: {
      screenTiles: async () => {
        called = true;
        return { routedTo: 'water-tile-screening' };
      }
    }
  });

  const result = await adapter.fetchData(normalizedRequest({
    mode: 'sentinel-hub-statistics',
    responseProfile: 'water-tile-screening'
  }));

  assert.equal(called, true);
  assert.deepEqual(result, { routedTo: 'water-tile-screening' });
});

test('Copernicus fetchData routes water-quality-statistics to statisticsAdapter', async () => {
  let called = false;
  const adapter = createAdapter({
    statisticsAdapter: {
      fetchStatistics: async () => {
        called = true;
        return { routedTo: 'statistics' };
      }
    }
  });

  const result = await adapter.fetchData(normalizedRequest({
    mode: 'sentinel-hub-statistics',
    responseProfile: 'water-quality-statistics'
  }));

  assert.equal(called, true);
  assert.deepEqual(result, { routedTo: 'statistics' });
});

test('Copernicus fetchData routes sentinel-3-surface-temperature to statisticsAdapter', async () => {
  let called = false;
  const adapter = createAdapter({
    statisticsAdapter: {
      fetchStatistics: async () => {
        called = true;
        return { routedTo: 'statistics' };
      }
    }
  });

  const result = await adapter.fetchData(normalizedRequest({
    mode: 'sentinel-hub-statistics',
    responseProfile: 'sentinel-3-surface-temperature'
  }));

  assert.equal(called, true);
  assert.deepEqual(result, { routedTo: 'statistics' });
});

test('Copernicus fetchData routes target-date-image to processAdapter', async () => {
  let called = false;
  const adapter = createAdapter({
    processAdapter: {
      fetchImages: async () => {
        called = true;
        return { routedTo: 'process-images' };
      }
    }
  });

  const result = await adapter.fetchData(normalizedRequest({
    mode: 'sentinel-hub-process',
    responseProfile: 'target-date-image'
  }));

  assert.equal(called, true);
  assert.deepEqual(result, { routedTo: 'process-images' });
});

test('Copernicus fetchData falls back to fetchExternalRequest for sentinel-hub-catalog', async () => {
  const adapter = createAdapter();
  let called = false;

  adapter.fetchExternalRequest = async () => {
    called = true;
    return { routedTo: 'external' };
  };

  const result = await adapter.fetchData(normalizedRequest({
    mode: 'sentinel-hub-catalog',
    responseProfile: 'scene-search-compatibility'
  }));

  assert.equal(called, true);
  assert.deepEqual(result, { routedTo: 'external' });
});

test('Copernicus fetchData falls back to fetchExternalRequest for scene-download-compatibility', async () => {
  const adapter = createAdapter();
  let called = false;

  adapter.fetchExternalRequest = async () => {
    called = true;
    return { routedTo: 'external' };
  };

  const result = await adapter.fetchData(normalizedRequest({
    mode: 'sentinel-hub-process',
    responseProfile: 'scene-download-compatibility'
  }));

  assert.equal(called, true);
  assert.deepEqual(result, { routedTo: 'external' });
});

test('Copernicus fetchData falls back to fetchExternalRequest for stac', async () => {
  const adapter = createAdapter();
  let called = false;

  adapter.fetchExternalRequest = async () => {
    called = true;
    return { routedTo: 'external' };
  };

  const result = await adapter.fetchData(normalizedRequest());

  assert.equal(called, true);
  assert.deepEqual(result, { routedTo: 'external' });
});

test('Copernicus fetchData normalizes non-AppError handler errors', async () => {
  const adapter = createAdapter({
    waterTileScreeningService: {
      screenTiles: async () => {
        throw new Error('handler failed');
      }
    }
  });

  await assert.rejects(
    () => adapter.fetchData(normalizedRequest({
      mode: 'sentinel-hub-statistics',
      responseProfile: 'water-tile-screening'
    })),
    (error) => {
      assert.equal(error.code, 'EXTERNAL_API_ERROR');
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /Copernicus sentinel-hub-statistics search failed/);
      assert.match(error.message, /handler failed/);
      return true;
    }
  );
});

test('Copernicus fetchData rethrows AppError handler errors unchanged', async () => {
  const appError = new AppError('handler app error', 418, 'HANDLER_APP_ERROR');
  const adapter = createAdapter({
    waterTileScreeningService: {
      screenTiles: async () => {
        throw appError;
      }
    }
  });

  try {
    await adapter.fetchData(normalizedRequest({
      mode: 'sentinel-hub-statistics',
      responseProfile: 'water-tile-screening'
    }));
    assert.fail('Expected fetchData to reject');
  } catch (error) {
    assert.equal(error, appError);
  }
});
