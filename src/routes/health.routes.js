const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  
  res.json({
    success: true,
    service: 'data-ingestion-service',
    status: 'ok',
    mode: 'stateless'
  });
});

module.exports = router;
