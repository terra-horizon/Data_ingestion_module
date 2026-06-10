const BaseWrapper = require('./base.wrapper');

class SceneSearchCompatibilityWrapper extends BaseWrapper {
  supports(context) {
    return context.responseProfile === 'scene-search-compatibility'
      && context.source === 'copernicus'
      && context.datasetType === 'catalogue'
      && context.format === 'json';
  }

  transform(rawData, metadata, context) {
    const features = Array.isArray(rawData.features) ? rawData.features : [];
    const maxCloudPct = Number(context.query.cloudCoverageMax ?? 100);
    const maxImages = Number(context.query.maxImages || context.query.limit || 10);

    const scenes = features
      .map((feature, index) => this.toScene(feature, index, context))
      .filter((scene) => scene.datetime)
      .filter((scene) => scene.cloud_pct <= maxCloudPct)
      .sort((left, right) => this.toTimestamp(right.datetime) - this.toTimestamp(left.datetime))
      .slice(0, maxImages);

    return {
      data: scenes,
      metadata: {
        type: 'scene-search-results',
        count: scenes.length,
        provider: metadata.source,
        mode: metadata.mode,
        collection: metadata.collection,
        queriedAt: metadata.queriedAt
      }
    };
  }

  toScene(feature, index, context) {
    const props = feature.properties || {};

    return {
      scene_id: feature.id || `scene_${index}`,
      datetime: props.datetime || null,
      cloud_pct: Number(props['eo:cloud_cover'] ?? 100.0),
      collection: feature.collection || context.collection || 'sentinel-2-l2a',
      bbox: feature.bbox || context.query.bbox,
      properties: {
        platform: props.platform || null,
        constellation: props.constellation || null
      }
    };
  }

  toTimestamp(value) {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }
}

module.exports = SceneSearchCompatibilityWrapper;
