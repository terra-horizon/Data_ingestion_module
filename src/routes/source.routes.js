const express = require('express');
const asyncHandler = require('express-async-handler');
const sourceController = require('../controllers/source.controller');

const router = express.Router();

router.get('/', asyncHandler(sourceController.listSources));
router.get('/:source/health', asyncHandler(sourceController.sourceHealthCheck));

module.exports = router;
