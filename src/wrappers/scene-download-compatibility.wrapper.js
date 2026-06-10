const BaseWrapper = require('./base.wrapper');

class SceneDownloadCompatibilityWrapper extends BaseWrapper {
  supports(context) {
    return context.responseProfile === 'scene-download-compatibility'
      && context.source === 'copernicus'
      && context.datasetType === 'image'
      && ['tif', 'tiff', 'geotiff'].includes(context.format);
  }

  transform(rawData, metadata, context) {
    const buffer = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);

    return {
      data: {
        scene_id: context.query.scene.scene_id,
        datetime: context.query.scene.datetime,
        contentType: metadata.contentType || 'image/tiff',
        format: 'tiff',
        dataBase64: buffer.toString('base64'),
        sizeBytes: buffer.length,
        width: context.externalRequest.width,
        height: context.externalRequest.height,
        bbox: context.query.bbox
      },
      metadata: {
        type: 'scene-download-result',
        count: 1,
        provider: metadata.source,
        mode: metadata.mode,
        collection: metadata.collection,
        contentType: metadata.contentType || 'image/tiff',
        sizeBytes: buffer.length,
        queriedAt: metadata.queriedAt
      }
    };
  }
}

module.exports = SceneDownloadCompatibilityWrapper;
