const AppError = require('../../utils/app-error');

const COPERNICUS_REQUEST_RULES = {
  stac: {
    profiles: {
      standard: {
        requires: []
      },
      'copernicus-compatibility': {
        requires: []
      },
      'scene-search-compatibility': {
        requires: []
      }
    }
  },

  'sentinel-hub-catalog': {
    profiles: {
      'scene-search-compatibility': {
        requires: ['bbox', 'dateFrom', 'dateTo']
      }
    }
  },

  'sentinel-hub-process': {
    allowsDownload: true,
    profiles: {
      'scene-download-compatibility': {
        requires: ['scene']
      },
      'target-date-image': {
        requires: ['bbox', 'date', 'imageKeys']
      }
    }
  },

  'sentinel-hub-statistics': {
    profiles: {
      'water-quality-statistics': {
        requires: ['bbox', 'dateFrom', 'dateTo']
      },
      'sentinel-3-surface-temperature': {
        requires: ['bbox', 'dateFrom', 'dateTo']
      },
      'water-tile-screening': {
        requires: ['tiles', 'dateFrom', 'dateTo']
      }
    }
  }
};

function validateCopernicusRequest(normalizedRequest) {
  const modeRule = getModeRule(normalizedRequest.mode);

  if (normalizedRequest.options.download && !modeRule.allowsDownload) {
    throw new AppError('Product downloads are not enabled for this Copernicus mode', 400, 'DOWNLOAD_NOT_SUPPORTED');
  }

  const profileRule = getProfileRule(modeRule, normalizedRequest.mode, normalizedRequest.responseProfile);
  validateRequiredQueryFields(normalizedRequest.query, profileRule.requires || []);
}

function getModeRule(mode) {
  const modeRule = COPERNICUS_REQUEST_RULES[mode];

  if (!modeRule) {
    throw new AppError(`Unsupported Copernicus mode: ${mode}`, 400, 'UNSUPPORTED_MODE');
  }

  return modeRule;
}

function getProfileRule(modeRule, mode, responseProfile) {
  const profileRule = modeRule.profiles[responseProfile];

  if (!profileRule) {
    throw new AppError(`Unsupported responseProfile "${responseProfile}" for Copernicus mode "${mode}"`, 400, 'UNSUPPORTED_PROFILE');
  }

  return profileRule;
}

function validateRequiredQueryFields(query, requiredFields) {
  const missingFields = requiredFields.filter((field) => isMissingValue(query[field]));

  if (missingFields.length > 0) {
    throw new AppError(`Missing required Copernicus query fields: ${missingFields.join(', ')}`, 400, 'VALIDATION_ERROR');
  }
}

function isMissingValue(value) {
  return value === undefined
    || value === null
    || value === ''
    || (Array.isArray(value) && value.length === 0);
}

module.exports = {
  COPERNICUS_REQUEST_RULES,
  getModeRule,
  getProfileRule,
  isMissingValue,
  validateCopernicusRequest,
  validateRequiredQueryFields
};
