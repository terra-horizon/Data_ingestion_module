const { ObjectId } = require('mongodb');
const env = require('../config/env');
const { getDb } = require('../db/mongo');
const AppError = require('../utils/app-error');

async function getCollection() {
  const db = await getDb();
  return db.collection(env.mongo.metadataCollection);
}

async function createMetadata(record) {
  const collection = await getCollection();
  const now = new Date();
  const document = {
    ...record,
    createdAt: now,
    updatedAt: now
  };
  const result = await collection.insertOne(document);

  return {
    ...document,
    _id: result.insertedId
  };
}

async function updateMetadata(id, patch) {
  const collection = await getCollection();
  const objectId = toObjectId(id);
  const update = {
    ...patch,
    updatedAt: new Date()
  };

  await collection.updateOne({ _id: objectId }, { $set: update });
  return collection.findOne({ _id: objectId });
}

async function findById(id) {
  const collection = await getCollection();
  return collection.findOne({ _id: toObjectId(id) });
}

function toObjectId(id) {
  if (!ObjectId.isValid(id)) {
    throw new AppError('Invalid ingestion metadata id', 400, 'VALIDATION_ERROR');
  }

  return new ObjectId(id);
}

module.exports = {
  createMetadata,
  updateMetadata,
  findById
};
