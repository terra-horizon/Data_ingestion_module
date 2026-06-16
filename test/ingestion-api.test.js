const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
  });
}

async function withMockProvider(handler, testFn) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({ method: req.method, url: req.url, body });
    handler(req, res, body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await testFn(baseUrl, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function loadFreshApp(envOverrides) {
  Object.assign(process.env, envOverrides);

  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${process.cwd()}\\src\\`) || key.includes(`${process.cwd()}/src/`)) {
      delete require.cache[key];
    }
  }

  return require('../src/app');
}

function startApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json()
  };
}

function providerHandler(req, res, body) {
  if (req.url === '/token') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'mock-token', expires_in: 60 }));
    return;
  }

  if (req.url === '/statistics') {
    const payload = JSON.parse(body);
    if (payload.input.data[0].type === 'sentinel-3-slstr') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          {
            interval: { from: '2025-01-01T00:00:00Z' },
            outputs: { data: { bands: { B0: { stats: { mean: 291.57 } } } } }
          }
        ]
      }));
      return;
    }

    if (payload.aggregation.evalscript.includes('eobrowserStats')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
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
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
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
    }));
    return;
  }

  if (req.url === '/process') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(Buffer.from('mock-image'));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

async function runApiRequest(mockBaseUrl, requestBody) {
  const app = loadFreshApp({
    CDSE_TOKEN_URL: `${mockBaseUrl}/token`,
    CDSE_SH_STATISTICS_URL: `${mockBaseUrl}/statistics`,
    CDSE_SH_PROCESS_URL: `${mockBaseUrl}/process`,
    CDSE_CLIENT_ID: 'client',
    CDSE_CLIENT_SECRET: 'secret',
    CDSE_RATE_LIMIT_RETRY_DELAY_SECONDS: '0',
    CDSE_MAX_RETRIES: '2'
  });
  const { server, baseUrl } = await startApp(app);

  try {
    return await postJson(`${baseUrl}/api/ingestion/run`, requestBody);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('POST /api/ingestion/run returns Sentinel-2 water-quality statistics', async () => {
  await withMockProvider(providerHandler, async (mockBaseUrl) => {
    const response = await runApiRequest(mockBaseUrl, {
      source: 'copernicus',
      mode: 'sentinel-hub-statistics',
      responseProfile: 'water-quality-statistics',
      requestParams: {
        bbox: [22.1, 39.4, 22.8, 40.1],
        dateFrom: '2025-01-01',
        dateTo: '2025-01-31',
        maxCloudCoverage: 30
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data[0].date, '2025-01-01');
    assert.equal(typeof response.body.data[0].metrics.Chl_a, 'number');
  });
});

test('POST /api/ingestion/run returns Sentinel-3 surface temperature', async () => {
  await withMockProvider(providerHandler, async (mockBaseUrl) => {
    const response = await runApiRequest(mockBaseUrl, {
      source: 'copernicus',
      mode: 'sentinel-hub-statistics',
      responseProfile: 'sentinel-3-surface-temperature',
      requestParams: {
        bbox: [22.1, 39.4, 22.8, 40.1],
        dateFrom: '2025-01-01',
        dateTo: '2025-01-31'
      }
    });

    assert.equal(response.status, 200);
    assert.equal(Number(response.body.data[0].metrics.s3_surface_temperature.toFixed(2)), 18.42);
  });
});

test('POST /api/ingestion/run returns water tile screening', async () => {
  await withMockProvider(providerHandler, async (mockBaseUrl) => {
    const response = await runApiRequest(mockBaseUrl, {
      source: 'copernicus',
      mode: 'sentinel-hub-statistics',
      responseProfile: 'water-tile-screening',
      requestParams: {
        tiles: [{ name: 'tile_0', bbox: [22.1, 39.4, 22.2, 39.5] }],
        dateFrom: '2025-01-01',
        dateTo: '2026-01-01',
        maxCloudCoverage: 30
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data[0].tileName, 'tile_0');
    assert.equal(response.body.data[0].selected, true);
  });
});

test('POST /api/ingestion/run returns target-date image as base64', async () => {
  await withMockProvider(providerHandler, async (mockBaseUrl) => {
    const response = await runApiRequest(mockBaseUrl, {
      source: 'copernicus',
      mode: 'sentinel-hub-process',
      responseProfile: 'target-date-image',
      requestParams: {
        bbox: [22.1, 39.4, 22.2, 39.5],
        date: '2026-05-27',
        tileName: 'tile_0',
        tileSize: 400,
        imageKeys: ['true_color'],
        format: 'image/png'
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data[0].status, 'available');
    assert.equal(response.body.data[0].dataBase64, Buffer.from('mock-image').toString('base64'));
  });
});

test('POST /api/ingestion/run returns 400 for unsupported profile', async () => {
  await withMockProvider(providerHandler, async (mockBaseUrl) => {
    const response = await runApiRequest(mockBaseUrl, {
      source: 'copernicus',
      mode: 'sentinel-hub-statistics',
      responseProfile: 'scene-search-compatibility',
      requestParams: {
        bbox: [22.1, 39.4, 22.8, 40.1],
        dateFrom: '2025-01-01',
        dateTo: '2025-01-31'
      }
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, 'UNSUPPORTED_PROFILE');
  });
});
