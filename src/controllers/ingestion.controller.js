const ingestionService = require('../services/ingestion.service');
const { getPersistenceService, getUc1Service } = require('../config/persistence');

async function runIngestion(req, res) {
  const result = await ingestionService.runIngestion(req.body, {
    persistence: getPersistenceService(),
    uc1Service: getUc1Service(),
    idempotencyKey: req.get('Idempotency-Key') || req.get('X-Idempotency-Key')
  });

  res.json({
    success: true,
    ...result
  });
}

module.exports = {
  runIngestion
};
