const express = require('express');
const asyncHandler = require('express-async-handler');
const ingestionController = require('../controllers/ingestion.controller');
const runController = require('../controllers/ingestion-run.controller');

const router = express.Router();

router.post('/run', asyncHandler(ingestionController.runIngestion));
router.get('/runs/:id', asyncHandler(runController.getRun));
router.get('/runs/:id/status', asyncHandler(runController.getRunStatus));
router.get('/runs/:id/results', asyncHandler(runController.getRunResults));

module.exports = router;
