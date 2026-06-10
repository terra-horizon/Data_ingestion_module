const { getSourceAdapter, listSources: listRegisteredSources } = require('../sources/source.registry');

async function listSources(req, res) {
  
  res.json({
    success: true,
    sources: listRegisteredSources()
  });
}

async function sourceHealthCheck(req, res) {

  const adapter = getSourceAdapter(req.params.source);
  const health = await adapter.healthCheck();

  res.json({
    success: true,
    health
  });
}

module.exports = {
  listSources,
  sourceHealthCheck
};
