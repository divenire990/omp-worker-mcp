import { validateRecord } from './validator.js';
import { transformPayload } from './transformer.js';
import { enrichAlpha } from './modules/alpha-enricher.js';
import { formatBeta } from './modules/beta-formatter.js';
import { PipelineStorage } from './storage.js';

/**
 * Main Pipeline Orchestrator.
 * Coordinates validation, transformation, enrichment, formatting, and storage.
 */
export class DataPipeline {
  constructor(options = {}) {
    this.storage = new PipelineStorage(options.storageOptions);
  }

  /**
   * Process a single record through the end-to-end pipeline.
   * @param {Object} record Raw input record
   * @param {Object} [options] Processing options
   * @returns {Object} Final formatted envelope stored in pipeline
   */
  process(record, options = {}) {
    // 1. Validate
    validateRecord(record);

    // 2. Transform
    const transformed = transformPayload(record);

    // 3. Alpha Enrichment
    const enriched = enrichAlpha(transformed, options.alphaOptions);

    // 4. Beta Formatting
    const formatted = formatBeta(enriched, options.betaOptions);

    // 5. Store
    this.storage.save(formatted.envelopeId, formatted, options.ttlMs);

    return formatted;
  }
}
