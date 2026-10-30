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

/** True when a path has an empty, "." or ".." segment: JSZip resolves those away, so the name it loads differs from the one measured. */
export function unusualEntryPath(name: string): boolean {
  const path = name.replaceAll('\\', '/').replace(/\/$/, '');
  return path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

const EOCD = 0x06054b50;
const CENTRAL_RECORD = 0x02014b50;

/**
 * True when the zip's end-of-central-directory record describes its central
 * directory exactly: the directory ends where that record starts (JSZip shifts
 * every offset when there is a gap, so the two parsers would read different
 * entries), and it holds exactly the number of records declared (JSZip reads
 * past the count, yauzl stops at it). Excel always writes it this way; ZIP64 is
 * refused, since no workbook under the upload cap needs it.
 */
export function zipLayoutIsExact(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === EOCD && at + 22 + view.getUint16(at + 20, true) === bytes.length) {
      eocd = at;
      break;
    }
  }
  if (eocd === -1) return false;
  const declared = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (declared === 0xffff || size === 0xffffffff || offset === 0xffffffff) return false;
  if (offset + size !== eocd) return false;
  let at = offset;
  let records = 0;
  while (at < eocd) {
    if (at + 46 > eocd || view.getUint32(at, true) !== CENTRAL_RECORD) return false;
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    records += 1;
  }
  return at === eocd && records === declared;
}
