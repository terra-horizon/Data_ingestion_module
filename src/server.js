const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');

const server = app.listen(env.port, () => {
  logger.info('Data ingestion API listening', {
    port: env.port,
    nodeEnv: env.nodeEnv
  });
});

server.on('error', (error) => {
  logger.error('Failed to start API server', { error: error.message });
  process.exit(1);
});

async function shutdown(signal) {
  logger.info('Shutting down API', { signal });

  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
