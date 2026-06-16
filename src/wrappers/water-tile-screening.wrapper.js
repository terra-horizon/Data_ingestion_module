const BaseWrapper = require('./base.wrapper');

class WaterTileScreeningWrapper extends BaseWrapper {
  supports(context) {
    return context.source === 'copernicus'
      && context.mode === 'sentinel-hub-statistics'
      && context.responseProfile === 'water-tile-screening';
  }

  transform(rawData, metadata) {
    const data = rawData.map((tileResult) => {
      const scenes = this.parseScenes(tileResult.rawData);
      const score = this.scoreScenes(scenes, metadata.maxCloudCoverage);

      return {
        tileName: tileResult.tile.name,
        bbox: tileResult.tile.bbox,
        selected: score > 0,
        score,
        scenes
      };
    });

    return {
      data,
      metadata: {
        ...metadata,
        scoring: {
          selectedWhen: 'score > 0',
          scoreDescription: '75th percentile water percentage across scenes that contain valid pixels and pass cloud filtering.'
        }
      }
    };
  }

  parseScenes(rawData) {
    const intervals = Array.isArray(rawData && rawData.data) ? rawData.data : [];

    return intervals.map((item) => {
      const interval = item.interval || {};
      const outputs = item.outputs || {};
      const statsOutput = outputs.eobrowserStats || outputs.data || {};
      const bands = statsOutput.bands || {};
      const waterStats = bands.B0 && bands.B0.stats ? bands.B0.stats : {};
      const cloudStats = bands.B1 && bands.B1.stats ? bands.B1.stats : {};
      const sampleCount = Number(waterStats.sampleCount || 0);
      const noDataCount = Number(waterStats.noDataCount || 0);
      const validPixels = Math.max(sampleCount - noDataCount, 0);

      return {
        date: interval.from ? String(interval.from).slice(0, 10) : '',
        validPixels,
        sampleCount,
        noDataCount,
        waterPct: Math.max(0, Math.min(100, Number(waterStats.mean || 0) * 100)),
        cloudPct: Math.max(0, Math.min(100, Number(cloudStats.mean || 0) * 100))
      };
    });
  }

  scoreScenes(scenes, maxCloudCoverage = 30) {
    const validScores = scenes
      .filter((scene) => scene.validPixels > 0 && scene.cloudPct <= Number(maxCloudCoverage))
      .map((scene) => scene.waterPct)
      .sort((a, b) => a - b);

    if (validScores.length === 0) {
      return 0;
    }

    return percentile(validScores, 75);
  }
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const rank = (percentileValue / 100) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

module.exports = WaterTileScreeningWrapper;
