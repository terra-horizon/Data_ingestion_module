const AppError = require('../utils/app-error');

class IngestionRunQueryService {
  constructor({ ingestionStore, projectionStore }) {
    this.ingestionStore = ingestionStore;
    this.projectionStore = projectionStore;
  }

  async get(reference, view = 'run') {
    const record =
      await this.ingestionStore.getIngestionResult(reference) ||
      await this.ingestionStore.findByIngestionRunId(reference) ||
      await this.ingestionStore.findByIdempotencyKey(reference);
    if (!record) throw new AppError('Ingestion run was not found', 404, 'INGESTION_RUN_NOT_FOUND');
    const base = {
      recordId: String(record._id),
      ingestionRunId: record.ingestionRunId || record.normalizedResult?.ingestionRunId,
      idempotencyKey: record.idempotencyKey,
      status: record.status,
      provider: record.provider,
      mode: record.mode,
      responseProfile: record.responseProfile,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
    if (view === 'status') {
      return {
        ...base,
        objectCount: record.objects?.length || 0,
        changedEntrySummary: summarizeChanges(record.changedEntries || [])
      };
    }
    if (view === 'results') {
      const observations = this.projectionStore && base.ingestionRunId
        ? await this.projectionStore.listObservationsByRun(base.ingestionRunId)
        : [];
      return {
        ...base,
        result: record.normalizedResult,
        objects: record.objects || [],
        changedEntries: record.changedEntries || [],
        observations
      };
    }
    return {
      ...base,
      requestSummary: record.requestSummary,
      objects: record.objects || [],
      changedEntrySummary: summarizeChanges(record.changedEntries || [])
    };
  }
}

function summarizeChanges(entries) {
  return entries.reduce((summary, entry) => {
    summary[entry.operation] = (summary[entry.operation] || 0) + 1;
    return summary;
  }, {});
}

module.exports = IngestionRunQueryService;
