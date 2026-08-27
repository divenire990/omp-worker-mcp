/**
 * Input validator for data-pipeline.
 * Ensures input records have required fields and valid basic types.
 */
export function validateRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Record must be a non-null object');
  }

  if (typeof record.id !== 'string' || record.id.trim() === '') {
    throw new Error('Record missing required non-empty string field: id');
  }

  if (typeof record.type !== 'string' || record.type.trim() === '') {
    throw new Error('Record missing required non-empty string field: type');
  }

  if (!record.payload || typeof record.payload !== 'object') {
    throw new Error('Record missing required object field: payload');
  }

  return true;
}
