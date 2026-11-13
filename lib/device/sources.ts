// The phone's source wire names, in a module with no server-only imports, so client code (the
// Android privacy screens) can use the list as a value. lib/device/http.ts re-exports it.

/** The wire names, exactly as the phone sends them and as the SQL checks them. */
export const SOURCES = [
  'test',
  'notifications',
  'calendar',
  'contacts',
  'calls',
  'health',
  'usage',
  'phone_state',
  'location',
] as const;
export type Source = (typeof SOURCES)[number];
