const axios = require('axios');
const env = require('../config/env');
const AppError = require('./app-error');

const httpClient = axios.create({
  timeout: env.requestTimeoutMs,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
});

function normalizeHttpError(error, fallbackMessage) {
  if (error.response) {
    const detail = error.response.data && (error.response.data.message || error.response.data.error || error.response.data.detail);
    return new AppError(
      `${fallbackMessage}: ${error.response.status} ${detail || error.response.statusText}`,
      502,
      'EXTERNAL_API_ERROR'
    );
  }

  if (error.code === 'ECONNABORTED') {
    return new AppError(`${fallbackMessage}: request timed out`, 504, 'EXTERNAL_API_TIMEOUT');
  }

  return new AppError(`${fallbackMessage}: ${error.message}`, 502, 'EXTERNAL_API_ERROR');
}

module.exports = {
  httpClient,
  normalizeHttpError
};
