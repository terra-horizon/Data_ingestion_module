const AppError = require('../utils/app-error');

class Sentinel3Adapter {
  constructor(config) {
    this.config = config;
  }

  async collect() {
    if (!this.config.uc1.enableSentinel3) {
      throw new AppError('Sentinel-3 UC1 ingestion is not configured', 501, 'SENTINEL3_NOT_CONFIGURED');
    }
    throw new AppError(
      'Sentinel-3 product/evalscript contract must be confirmed before live ingestion is enabled',
      501,
      'SENTINEL3_CONTRACT_UNCONFIRMED'
    );
  }
}

module.exports = Sentinel3Adapter;
