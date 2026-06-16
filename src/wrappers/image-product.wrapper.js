const BaseWrapper = require('./base.wrapper');

class ImageProductWrapper extends BaseWrapper {
  supports(context) {
    return context.source === 'copernicus'
      && context.mode === 'sentinel-hub-process'
      && context.responseProfile === 'target-date-image';
  }

  transform(rawData, metadata) {
    return {
      data: rawData.map((image) => ({
        imageKey: image.imageKey,
        status: image.status,
        contentType: image.contentType,
        dataBase64: image.dataBase64,
        sizeBytes: image.sizeBytes,
        requestedDate: image.requestedDate,
        actualDate: image.actualDate,
        collection: image.collection,
        message: image.message
      })),
      metadata
    };
  }
}

module.exports = ImageProductWrapper;
