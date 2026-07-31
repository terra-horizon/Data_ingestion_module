const { getIngestionRunQueryService } = require('../config/persistence');

async function getRun(req, res) {
  res.json({ success: true, data: await service().get(req.params.id, 'run') });
}

async function getRunStatus(req, res) {
  res.json({ success: true, data: await service().get(req.params.id, 'status') });
}

async function getRunResults(req, res) {
  res.json({ success: true, data: await service().get(req.params.id, 'results') });
}

function service() {
  const queryService = getIngestionRunQueryService();
  if (!queryService) {
    const error = new Error('Ingestion persistence is disabled');
    error.statusCode = 503;
    error.code = 'PERSISTENCE_DISABLED';
    throw error;
  }
  return queryService;
}

module.exports = { getRun, getRunResults, getRunStatus };
