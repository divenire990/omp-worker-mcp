import test from 'node:test';
import assert from 'node:assert/strict';
import { DataPipeline } from '../../src/index.js';

test('Integration: end-to-end pipeline processes and stores records', () => {
  const pipeline = new DataPipeline({
    storageOptions: { defaultTtlMs: 10000, maxCapacity: 50 },
  });

  const input = {
    id: 'tx-999',
    type: 'TRANSACTION',
    tags: ['financial', 'audit'],
    payload: { value: '  amount: 450.00  ' },
  };

  const result = pipeline.process(input, {
    alphaOptions: { stage: 'prod-stage' },
    betaOptions: { destination: 'warehouse-sink' },
  });

  assert.equal(result.envelopeId, 'env-tx-999');
  assert.equal(result.schemaVersion, '1.0.0');
  assert.equal(result.beta.destination, 'warehouse-sink');
  assert.equal(result.payload.value, 'amount: 450.00');
  assert.equal(result.payload.alpha.stage, 'prod-stage');

  // Verify storage persistence
  const stored = pipeline.storage.get('env-tx-999');
  assert.deepEqual(stored, result);
});
