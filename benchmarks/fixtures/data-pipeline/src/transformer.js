/**
 * Data transformation and normalization logic.
 *
 * NOTE FOR BENCHMARK CASE 02:
 * This module contains a deliberately seeded boundary handling defect.
 * When `record.tags` is undefined or null, invoking `.map()` directly throws
 * a TypeError instead of gracefully defaulting to an empty array.
 */
export function transformPayload(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Invalid record for transformation');
  }

  // SEEDED DEFECT: Directly calling .map on record.tags without defensive array check.
  // Fails with TypeError when record.tags is undefined or null.
  // Expected fix: const normalizedTags = Array.isArray(record.tags) ? record.tags.map(t => String(t).trim().toLowerCase()) : [];
  const normalizedTags = Array.isArray(record.tags) ? record.tags.map(t => String(t).trim().toLowerCase()) : [];

  const rawValue = record.payload?.value ?? '';
  const normalizedValue = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue);

  return {
    id: record.id,
    type: record.type.toLowerCase(),
    tags: normalizedTags,
    value: normalizedValue,
    transformedAt: Date.now(),
  };
}
