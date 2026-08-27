import test from 'node:test';
import assert from 'node:assert/strict';
import { PipelineStorage } from '../../src/storage.js';

test('Storage: saves and retrieves records within TTL', () => {
  const storage = new PipelineStorage({ defaultTtlMs: 5000 });
  storage.save('item-1', { foo: 'bar' });

  assert.equal(storage.has('item-1'), true);
  assert.deepEqual(storage.get('item-1'), { foo: 'bar' });
  assert.equal(storage.size, 1);
});

test('Storage: returns null and cleans up expired records on get', async () => {
  const storage = new PipelineStorage();
  storage.save('item-short', { temp: true }, 50); // 50ms TTL

  assert.equal(storage.has('item-short'), true);

  await new Promise(r => setTimeout(r, 70));

  assert.equal(storage.get('item-short'), null);
  assert.equal(storage.has('item-short'), false);
});

test('Storage: purgeStaleRecords removes expired entries and preserves active', async () => {
  const storage = new PipelineStorage();
  storage.save('item-expired', { old: true }, 40);
  storage.save('item-active', { active: true }, 10000);

  assert.equal(storage.size, 2);

  await new Promise(r => setTimeout(r, 60));

  const purged = storage.purgeStaleRecords();
  assert.equal(purged, 1);
  assert.equal(storage.size, 1);
  assert.equal(storage.has('item-active'), true);
  assert.equal(storage.has('item-expired'), false);
});

test('Storage: enforces maxCapacity by evicting oldest item when full', () => {
  const storage = new PipelineStorage({ maxCapacity: 2, defaultTtlMs: 100000 });
  storage.save('first', { index: 1 });
  storage.save('second', { index: 2 });
  assert.equal(storage.size, 2);

  storage.save('third', { index: 3 });
  assert.equal(storage.size, 2);
  assert.equal(storage.has('first'), false); // evicted
  assert.equal(storage.has('second'), true);
  assert.equal(storage.has('third'), true);
});

test('Storage: delete removes item immediately', () => {
  const storage = new PipelineStorage();
  storage.save('item-del', { toDelete: true });
  assert.equal(storage.delete('item-del'), true);
  assert.equal(storage.has('item-del'), false);
});
