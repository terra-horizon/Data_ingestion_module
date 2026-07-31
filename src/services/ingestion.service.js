const { normalizeRequest } = require('../handlers/request-normalizer');
const { getSourceAdapter } = require('../sources/source.registry');
const { getWrapper } = require('../wrappers/wrapper.registry');
const { isUc1Request } = require('../validation/uc1-aoi-request');
const AppError = require('../utils/app-error');

async function runIngestion(payload, dependencies = {}) {
  if (isUc1Request(payload)) {
    if (!dependencies.uc1Service) {
      throw new AppError('UC1 AOI ingestion requires persistence to be enabled', 503, 'PERSISTENCE_DISABLED');
    }
    return dependencies.uc1Service.run(payload, { idempotencyKey: dependencies.idempotencyKey });
  }
  const normalizedRequest = normalizeRequest(payload);
  const adapter = dependencies.adapter || getSourceAdapter(normalizedRequest.source);
  const sourceResponse = await adapter.fetchData(normalizedRequest);
  const metadata = adapter.extractMetadata(sourceResponse);
  const wrapperContext = { ...normalizedRequest, externalRequest: sourceResponse.externalRequest };
  const wrapper = dependencies.wrapper || getWrapper(wrapperContext);
  const wrapped = wrapper.transform(sourceResponse.rawData, metadata, wrapperContext);

  const result = {
    ingestionRunId: normalizedRequest.operation.ingestionRunId,
    source: normalizedRequest.source,
    mode: normalizedRequest.mode,
    collection: normalizedRequest.collection,
    responseProfile: normalizedRequest.responseProfile,
    data: wrapped.data,
    metadata: wrapped.metadata
  };
  if (!dependencies.persistence) return result;

  const persisted = await dependencies.persistence.persist({
    payload,
    normalizedRequest,
    result,
    explicitIdempotencyKey: dependencies.idempotencyKey
  });
  return { ...persisted.result, persistence: persisted.persistence };
}

module.exports = { runIngestion };
