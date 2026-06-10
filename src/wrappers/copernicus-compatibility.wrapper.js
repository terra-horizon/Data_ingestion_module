const BaseWrapper = require('./base.wrapper');

class CopernicusCompatibilityWrapper extends BaseWrapper {
  supports(context) {
    return context.responseProfile === 'copernicus-compatibility'
      && context.source === 'copernicus'
      && context.datasetType === 'catalogue'
      && context.format === 'json';
  }

  transform(rawData, metadata) {
    const features = Array.isArray(rawData.features) ? rawData.features : [];

    const data = {
      products: features.map((feature) => ({
        id: feature.id,
        date: feature.properties ? feature.properties.datetime : null,
        cloudCoverage: feature.properties ? feature.properties['eo:cloud_cover'] ?? null : null,
        downloadLinks: this.extractDownloadLinks(feature),
        rawAssets: feature.assets || {}
      })),
      count: features.length,
      source: metadata.source
    };

    return {
      data,
      metadata: {
        type: 'copernicus-products',
        count: data.count,
        provider: metadata.source,
        mode: metadata.mode,
        collection: metadata.collection,
        queriedAt: metadata.queriedAt
      }
    };
  }

  extractDownloadLinks(feature) {
    const links = {};

    for (const link of feature.links || []) {
      if (link.rel && link.href) {
        links[link.rel] = link.href;
      }
    }

    return links;
  }
}

module.exports = CopernicusCompatibilityWrapper;
