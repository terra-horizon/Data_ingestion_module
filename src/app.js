const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const env = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const ingestionRoutes = require('./routes/ingestion.routes');
const sourceRoutes = require('./routes/source.routes');
const notFoundMiddleware = require('./middleware/not-found.middleware');
const errorMiddleware = require('./middleware/error.middleware');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.use('/api/health', healthRoutes);
app.use('/api/ingestion', ingestionRoutes);
app.use('/api/sources', sourceRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

module.exports = app;
