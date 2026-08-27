/**
 * Beta Formatter module (Disjoint Write Target B for Case 03).
 * Formats enriched records into standard delivery envelopes and adds schema markers.
 */
export function formatBeta(record, options = {}) {
  if (!record || typeof record !== 'object') {
    throw new Error('Invalid record passed to Beta Formatter');
  }

  const formatVersion = options.formatVersion ?? '1.0.0';

  return {
    schemaVersion: formatVersion,
    envelopeId: `env-${record.id}`,
    emittedAt: new Date().toISOString(),
    payload: record,
    beta: {
      status: 'formatted',
      destination: options.destination ?? 'default-sink',
    },
  };
}
