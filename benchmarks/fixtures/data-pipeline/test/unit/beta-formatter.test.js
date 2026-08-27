import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBeta } from '../../src/modules/beta-formatter.js';

test('Beta Formatter: wraps record into envelope with versioning', () => {
  const input = {
    id: 'item-200',
    type: 'log',
    tags: ['audit'],
    value: 'user-login',
    alpha: { status: 'enriched' },
  };

  const formatted = formatBeta(input, { destination: 'security-sink', formatVersion: '2.1.0' });
  assert.equal(formatted.schemaVersion, '2.1.0');
  assert.equal(formatted.envelopeId, 'env-item-200');
  assert.equal(formatted.beta.destination, 'security-sink');
  assert.equal(formatted.beta.status, 'formatted');
  assert.deepEqual(formatted.payload, input);
});

test('Beta Formatter: throws on invalid record', () => {
  assert.throws(() => formatBeta(null), /Invalid record/);
});
