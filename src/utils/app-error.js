class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR', details = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.provider = details.provider;
    this.retryable = details.retryable;
  }
}

module.exports = AppError;
