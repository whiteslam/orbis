const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A real UUID string (8-4-4-4-12 hex), not merely 36 hex-or-dash characters. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
