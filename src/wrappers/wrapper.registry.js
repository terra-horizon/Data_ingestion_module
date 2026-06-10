const AppError = require('../utils/app-error');
const StandardCatalogueWrapper = require('./standard-catalogue.wrapper');
const CopernicusCompatibilityWrapper = require('./copernicus-compatibility.wrapper');
const SceneSearchCompatibilityWrapper = require('./scene-search-compatibility.wrapper');
const SceneDownloadCompatibilityWrapper = require('./scene-download-compatibility.wrapper');

const wrappers = [
  new StandardCatalogueWrapper(),
  new CopernicusCompatibilityWrapper(),
  new SceneSearchCompatibilityWrapper(),
  new SceneDownloadCompatibilityWrapper()
];

function getWrapper(context) {
  const wrapper = wrappers.find((candidate) => candidate.supports(context));

  if (!wrapper) {
    throw new AppError('No wrapper supports the requested dataset, format, source, and responseProfile', 400, 'UNSUPPORTED_WRAPPER');
  }

  return wrapper;
}

module.exports = {
  getWrapper
};
