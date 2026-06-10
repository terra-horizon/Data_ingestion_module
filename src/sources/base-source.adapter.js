class BaseSourceAdapter {
  getName() {
    throw new Error('getName must be implemented by source adapters');
  }

  healthCheck() {
    throw new Error('healthCheck must be implemented by source adapters');
  }

  validateRequest() {
    throw new Error('validateRequest must be implemented by source adapters');
  }

  buildExternalRequest() {
    throw new Error('buildExternalRequest must be implemented by source adapters');
  }

  fetchData() {
    throw new Error('fetchData must be implemented by source adapters');
  }

  extractMetadata() {
    throw new Error('extractMetadata must be implemented by source adapters');
  }
}

module.exports = BaseSourceAdapter;
