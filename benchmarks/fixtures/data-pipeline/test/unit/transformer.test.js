import test from 'node:test';
import assert from 'node:assert/strict';
import { transformPayload } from '../../src/transformer.js';

test('Transformer: transforms valid payload with explicit tags array', () => {
  const input = {
    id: 'doc-001',
    type: 'DOCUMENT',
    tags: [' Alpha ', 'BETA'],
    payload: { value: '  raw text  ' },
  };

  const output = transformPayload(input);
  assert.equal(output.id, 'doc-001');
  assert.equal(output.type, 'document');
  assert.deepEqual(output.tags, ['alpha', 'beta']);
  assert.equal(output.value, 'raw text');
  assert.ok(typeof output.transformedAt === 'number');
});

test('Transformer: handles missing or null tags gracefully (Seeded Bug Check for Case 02)', () => {
  const inputWithoutTags = {
    id: 'doc-002',
    type: 'EVENT',
    payload: { value: 'plain' },
  };

  const inputWithNullTags = {
    id: 'doc-003',
    type: 'EVENT',
    tags: null,
    payload: { value: 'plain' },
  };

  // In the baseline seeded defect state, this throws TypeError.
  // When Case 02 bug fix is applied to src/transformer.js, these assertions pass with empty array.
  const out1 = transformPayload(inputWithoutTags);
  assert.deepEqual(out1.tags, []);

  const out2 = transformPayload(inputWithNullTags);
  assert.deepEqual(out2.tags, []);
});
