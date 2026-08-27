import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichAlpha } from '../../src/modules/alpha-enricher.js';

test('Alpha Enricher: enriches transformed record with stage metadata', () => {
  const input = {
    id: 'item-100',
    type: 'metric',
    tags: ['cpu'],
    value: '88%',
  };

  const enriched = enrichAlpha(input, { stage: 'custom-alpha' });
  assert.equal(enriched.id, 'item-100');
  assert.equal(enriched.type, 'metric');
  assert.equal(enriched.alpha.stage, 'custom-alpha');
  assert.equal(enriched.alpha.status, 'enriched');
  assert.ok(enriched.alpha.checksum.includes('item-100'));
});

test('Alpha Enricher: throws on invalid record', () => {
  assert.throws(() => enrichAlpha(null), /Invalid record/);
});
