const express = require('express');
const asyncHandler = require('express-async-handler');
const ingestionController = require('../controllers/ingestion.controller');

const router = express.Router();

router.post('/run', asyncHandler(ingestionController.runIngestion));

module.exports = router;
