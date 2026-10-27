// The archive pre-scan reads a workbook with yauzl, but ExcelJS reads it with JSZip, and the two can name the same
// zip entry differently: yauzl prefers an Info-ZIP Unicode Path extra field even when the UTF-8 flag is set (JSZip
// then ignores it), they decode non-ASCII names differently (CP437 against a lenient UTF-8 that accepts overlong
// forms of ASCII), and duplicate names leave one parser using an entry the other measured as something else.
// Excel never writes any of these, so a workbook carrying one is refused rather than reconciled.

const UNICODE_PATH_FIELD = 0x7075;
const UNICODE_COMMENT_FIELD = 0x6375;

/** True when an entry's raw name or extra fields could make yauzl and JSZip disagree about what it is called. */
export function ambiguousEntryName(rawName: Uint8Array, extraFieldIds: readonly number[]): boolean {
  if (extraFieldIds.some((id) => id === UNICODE_PATH_FIELD || id === UNICODE_COMMENT_FIELD)) return true;
  return rawName.some((byte) => byte >= 0x80);
}

/** The form under which two entry names count as the same file to some zip reader. */
export function entryNameKey(name: string): string {
  return name.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
}
