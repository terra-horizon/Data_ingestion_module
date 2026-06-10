const env = require('../config/env');
const logger = require('../utils/logger');

function errorMiddleware(error, req, res, next) {
  const statusCode = error.statusCode || 500;
  const code = error.code || 'INTERNAL_ERROR';

  logger.error('Request failed', {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code,
    error: error.message
  });

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 && env.nodeEnv === 'production' ? 'Internal server error' : error.message,
    code
  });
}

module.exports = errorMiddleware;
