/**
 * State persistence and retention storage manager for data-pipeline.
 * Supports in-memory record tracking, TTL expiration, stale record purging,
 * and capacity bounds.
 */
export class PipelineStorage {
  /**
   * @param {Object} [options]
   * @param {number} [options.defaultTtlMs=60000] Default TTL in milliseconds
   * @param {number} [options.maxCapacity=1000] Maximum stored records before eviction
   */
  constructor(options = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 60000;
    this.maxCapacity = options.maxCapacity ?? 1000;
    this.store = new Map();
  }

  /**
   * Persist a record with an explicit or default TTL.
   * @param {string} id
   * @param {Object} data
   * @param {number} [ttlMs]
   */
  save(id, data, ttlMs) {
    if (!id || typeof id !== 'string') {
      throw new Error('Storage key id must be a non-empty string');
    }

    // Capacity check: purge stale first, then evict oldest if still at capacity
    this.purgeStaleRecords();
    if (this.store.size >= this.maxCapacity && !this.store.has(id)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }

    const now = Date.now();
    const effectiveTtl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = now + effectiveTtl;

    this.store.set(id, {
      data,
      createdAt: now,
      expiresAt,
      ttlMs: effectiveTtl,
    });

    return { id, expiresAt };
  }

  /**
   * Retrieve a record by id if not expired.
   * @param {string} id
   */
  get(id) {
    const entry = this.store.get(id);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(id);
      return null;
    }

    return entry.data;
  }

  /**
   * Check if a record exists and is active.
   * @param {string} id
   */
  has(id) {
    return this.get(id) !== null;
  }

  /**
   * Delete a record by id.
   * @param {string} id
   */
  delete(id) {
    return this.store.delete(id);
  }

  /**
   * Purge all expired records from memory.
   * @returns {number} Number of purged records
   */
  purgeStaleRecords() {
    const now = Date.now();
    let purgedCount = 0;

    for (const [id, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(id);
        purgedCount++;
      }
    }

    return purgedCount;
  }

  /**
   * Current number of stored records (including un-purged expired).
   */
  get size() {
    return this.store.size;
  }

  /**
   * Clear all records.
   */
  clear() {
    this.store.clear();
  }
}
