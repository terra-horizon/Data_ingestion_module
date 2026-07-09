const { normalizeRequest } = require('../handlers/request-normalizer');
const { getSourceAdapter } = require('../sources/source.registry');
const { getWrapper } = require('../wrappers/wrapper.registry');
const persistenceService = require('./persistence.service');

async function runIngestion(payload) {
  const normalizedRequest = normalizeRequest(payload);
  persistenceService.assertConfigured();

  const adapter = getSourceAdapter(normalizedRequest.source);
  const sourceResponse = await adapter.fetchData(normalizedRequest);
  const metadata = adapter.extractMetadata(sourceResponse);

  const wrapperContext = {
    ...normalizedRequest,
    externalRequest: sourceResponse.externalRequest
  };
  const wrapper = getWrapper(wrapperContext);
  const wrapped = wrapper.transform(sourceResponse.rawData, metadata, wrapperContext);

  const result = {
    source: normalizedRequest.source,
    mode: normalizedRequest.mode,
    collection: normalizedRequest.collection,
    responseProfile: normalizedRequest.responseProfile,
    data: wrapped.data,
    metadata: wrapped.metadata
  };

  const persisted = await persistenceService.persistResult(payload, result, normalizedRequest);

  return {
    status: 'completed',
    useCaseId: String(payload.useCaseId || 'unspecified'),
    ...persisted.result,
    persistence: persisted.persistence
  };
}

module.exports = {
  runIngestion
};
