class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR', options = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = options.retryable === true;
    this.details = options.details;
  }
}

module.exports = AppError;
