import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord } from '../../src/validator.js';

test('Validator: accepts well-formed record', () => {
  const record = {
    id: 'rec-001',
    type: 'metric-event',
    payload: { value: 'test-value' },
  };

  assert.equal(validateRecord(record), true);
});

test('Validator: rejects null or non-object', () => {
  assert.throws(() => validateRecord(null), /Record must be a non-null object/);
  assert.throws(() => validateRecord('string'), /Record must be a non-null object/);
});

test('Validator: rejects missing or empty id', () => {
  assert.throws(() => validateRecord({ type: 'event', payload: {} }), /missing required non-empty string field: id/);
  assert.throws(() => validateRecord({ id: '  ', type: 'event', payload: {} }), /missing required non-empty string field: id/);
});

test('Validator: rejects missing or empty type', () => {
  assert.throws(() => validateRecord({ id: '001', payload: {} }), /missing required non-empty string field: type/);
});

test('Validator: rejects missing or invalid payload', () => {
  assert.throws(() => validateRecord({ id: '001', type: 'event' }), /missing required object field: payload/);
  assert.throws(() => validateRecord({ id: '001', type: 'event', payload: null }), /missing required object field: payload/);
});
