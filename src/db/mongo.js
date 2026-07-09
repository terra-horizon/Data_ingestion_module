const { MongoClient } = require('mongodb');
const env = require('../config/env');
const AppError = require('../utils/app-error');

let clientPromise;

function getDatabaseNameFromUri(uri) {
  try {
    const parsed = new URL(uri);
    const database = parsed.pathname.replace(/^\//, '');
    return database || undefined;
  } catch (error) {
    return undefined;
  }
}

async function getMongoClient() {
  if (!env.mongo.uri) {
    throw new AppError('MONGO_URI is required for persisted ingestion jobs', 503, 'MONGO_CONFIG_MISSING');
  }

  if (!clientPromise) {
    const client = new MongoClient(env.mongo.uri);
    clientPromise = client.connect();
  }

  return clientPromise;
}

async function getDb() {
  const client = await getMongoClient();
  const databaseName = env.mongo.database || getDatabaseNameFromUri(env.mongo.uri);

  if (!databaseName) {
    throw new AppError('Mongo database name is required in MONGO_URI or MONGO_DATABASE', 503, 'MONGO_CONFIG_MISSING');
  }

  return client.db(databaseName);
}

module.exports = {
  getDb
};

