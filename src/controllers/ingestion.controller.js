const ingestionService = require('../services/ingestion.service');
const objectStorage = require('../storage/objectStorage.service');
const AppError = require('../utils/app-error');

const PREVIEW_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff']);
const PREVIEW_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/geotiff', 'application/geotiff']);

async function runIngestion(req, res) {
  const result = await ingestionService.runIngestion(req.body);

  res.json({
    success: true,
    ...result
  });
}

async function getAsset(req, res) {
  const key = normalizeAssetKey(req.query.key);
  const object = await objectStorage.getObject(key);
  const contentType = normalizeContentType(object.contentType);
  const dispositionType = shouldDownload(req.query.download) ? 'attachment' : 'inline';

  if (!isPreviewObject(key, contentType)) {
    throw new AppError('Only persisted PNG, JPEG, and TIFF assets can be retrieved from this endpoint', 400, 'UNSUPPORTED_ASSET_PREVIEW');
  }

  res.setHeader('Content-Type', object.contentType || contentType);
  res.setHeader('Content-Length', String(object.sizeBytes));
  res.setHeader('Content-Disposition', `${dispositionType}; filename="${filenameFromKey(key)}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');

  object.stream.on('error', (error) => {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    } else {
      res.destroy(error);
    }
  });

  object.stream.pipe(res);
}

function normalizeAssetKey(value) {
  if (!value || typeof value !== 'string') {
    throw new AppError('key query parameter is required', 400, 'VALIDATION_ERROR');
  }

  const key = extractAssetKey(value);
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\')) {
    throw new AppError('Invalid asset key', 400, 'VALIDATION_ERROR');
  }

  if (!key.startsWith('ingestions/')) {
    throw new AppError('Asset key must reference an ingestion object', 400, 'VALIDATION_ERROR');
  }

  return key;
}

function extractAssetKey(value) {
  let key = stripWrappingQuotes(String(value || '').trim());

  if (key.includes('/api/ingestion/assets?')) {
    key = key.slice(key.indexOf('/api/ingestion/assets?'));
  }

  if (key.startsWith('/api/ingestion/assets?')) {
    const params = new URLSearchParams(key.slice(key.indexOf('?') + 1));
    key = params.get('key') || '';
  }

  return stripWrappingQuotes(key.trim());
}

function stripWrappingQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function isPreviewObject(key, contentType) {
  return PREVIEW_EXTENSIONS.has(extensionFromKey(key)) || PREVIEW_CONTENT_TYPES.has(contentType);
}

function extensionFromKey(key) {
  const match = String(key).match(/(\.[a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function normalizeContentType(contentType) {
  return String(contentType || '').split(';')[0].trim().toLowerCase();
}

function shouldDownload(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function filenameFromKey(key) {
  return String(key).split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '-') || 'asset';
}

module.exports = {
  runIngestion,
  getAsset
};
