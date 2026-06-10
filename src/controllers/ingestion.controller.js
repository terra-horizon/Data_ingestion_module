const ingestionService = require('../services/ingestion.service');

async function runIngestion(req, res) {
  
  const result = await ingestionService.runIngestion(req.body);

  res.json({
    success: true,
    ...result
  });
}

module.exports = {
  runIngestion
};
