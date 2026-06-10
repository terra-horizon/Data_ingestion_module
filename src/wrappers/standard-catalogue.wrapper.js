const BaseWrapper = require('./base.wrapper');

class StandardCatalogueWrapper extends BaseWrapper {
  supports(context) {
    return context.responseProfile === 'standard'
      && context.datasetType === 'catalogue'
      && context.format === 'json';
  }

  transform(rawData, metadata, context) {
    const features = Array.isArray(rawData.features) ? rawData.features : [];

    const data = {
      type: 'catalogue-results',
      source: metadata.source,
      mode: metadata.mode,
      collection: metadata.collection,
      count: features.length,
      items: features.map((feature) => ({
        id: feature.id,
        collection: feature.collection || metadata.collection,
        datetime: feature.properties ? feature.properties.datetime : null,
        bbox: feature.bbox || [],
        cloudCoverage: feature.properties ? feature.properties['eo:cloud_cover'] ?? null : null,
        assets: feature.assets || {},
        links: feature.links || []
      })),
      metadata: {
        provider: metadata.source,
        queriedAt: metadata.queriedAt,
        externalRequest: context.externalRequest
      }
    };

    return {
      data,
      metadata: {
        type: data.type,
        count: data.count,
        provider: metadata.source,
        mode: metadata.mode,
        collection: metadata.collection,
        queriedAt: metadata.queriedAt
      }
    };
  }
}

module.exports = StandardCatalogueWrapper;
