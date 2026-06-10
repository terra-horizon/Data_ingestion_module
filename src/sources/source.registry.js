const AppError = require('../utils/app-error');
const CopernicusAdapter = require('./copernicus.adapter');

const sources = new Map();

function registerSource(name, adapter) {
  sources.set(name.toLowerCase(), adapter);
}

function getSourceAdapter(sourceName) {
  const adapter = sources.get(String(sourceName).toLowerCase());

  if (!adapter) {
    throw new AppError(`Unknown source: ${sourceName}`, 400, 'UNKNOWN_SOURCE');
  }

  return adapter;
}

function listSources() {
  return Array.from(sources.entries()).map(([name, adapter]) => ({
    name,
    adapter: adapter.constructor.name
  }));
}

registerSource('copernicus', new CopernicusAdapter());

module.exports = {
  getSourceAdapter,
  listSources,
  registerSource
};
