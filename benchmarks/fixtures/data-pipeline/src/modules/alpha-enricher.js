/**
 * Alpha Enricher module (Disjoint Write Target A for Case 03).
 * Enriches transformed records with execution metadata, checksums, and audit fields.
 */
export function enrichAlpha(record, options = {}) {
  if (!record || typeof record !== 'object') {
    throw new Error('Invalid record passed to Alpha Enricher');
  }

  const stage = options.stage ?? 'alpha-stage';
  const timestamp = Date.now();

  return {
    ...record,
    alpha: {
      stage,
      enrichedAt: timestamp,
      checksum: `sha256-mock-${record.id}-${timestamp}`,
      status: 'enriched',
    },
  };
}
