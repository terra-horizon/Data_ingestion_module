const { normalizeRequest } = require('../handlers/request-normalizer');
const { getSourceAdapter } = require('../sources/source.registry');
const { getWrapper } = require('../wrappers/wrapper.registry');

async function runIngestion(payload) {
  const normalizedRequest = normalizeRequest(payload);

  const adapter = getSourceAdapter(normalizedRequest.source);
  const sourceResponse = await adapter.fetchData(normalizedRequest);
  const metadata = adapter.extractMetadata(sourceResponse);

  const wrapperContext = {
    ...normalizedRequest,
    externalRequest: sourceResponse.externalRequest
  };
  const wrapper = getWrapper(wrapperContext);
  const wrapped = wrapper.transform(sourceResponse.rawData, metadata, wrapperContext);

  return {
    source: normalizedRequest.source,
    mode: normalizedRequest.mode,
    collection: normalizedRequest.collection,
    responseProfile: normalizedRequest.responseProfile,
    data: wrapped.data,
    metadata: wrapped.metadata
  };
}

module.exports = {
  runIngestion
};
