const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { closePersistence } = require('./config/persistence');

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

  server.close(async () => {
    try {
      await closePersistence();
      process.exit(0);
    } catch (error) {
      logger.error('Persistence shutdown failed', { error: error.message });
      process.exit(1);
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
