import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readAppleHealthExport } from './read-export';

const step = (source: string, start: string, end: string, value: number) =>
  `  <Record type="HKQuantityTypeIdentifierStepCount" sourceName="${source}" unit="count" startDate="${start}" endDate="${end}" value="${value}"/>\n`;

function exportXml(days: number) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE HealthData [\n<!ATTLIST Record type CDATA #REQUIRED>\n]>\n<HealthData locale="en_IN">\n';
  for (let day = 1; day <= days; day += 1) {
    const date = `2026-08-${String(day).padStart(2, '0')}`;
    for (let hour = 6; hour < 22; hour += 1) {
      const h = String(hour).padStart(2, '0');
      xml += step('iPhone', `${date} ${h}:00:00 +0530`, `${date} ${h}:30:00 +0530`, 300);
      xml += step('Apple Watch', `${date} ${h}:00:00 +0530`, `${date} ${h}:30:00 +0530`, 320);
      xml += `  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" unit="count/min" startDate="${date} ${h}:10:00 +0530" endDate="${date} ${h}:10:00 +0530" value="80"/>\n`;
    }
  }
  return `${xml}</HealthData>\n`;
}

const asFile = (bytes: Uint8Array, name: string) => Object.assign(new Blob([bytes as Uint8Array<ArrayBuffer>]), { name });

describe('readAppleHealthExport', () => {
  const xml = exportXml(31);
  const expected = Array.from({ length: 31 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, steps: 16 * 320 }));

  it('reads a zipped export like the one the Health app produces', async () => {
    const zip = zipSync({ 'apple_health_export/export.xml': strToU8(xml), 'apple_health_export/export_cda.xml': strToU8(step('iPhone', '2026-08-01 06:00:00 +0530', '2026-08-01 06:10:00 +0530', 99999)) });
    const result = await readAppleHealthExport(asFile(zip, 'export.zip'));
    expect(result.days).toEqual(expected);
    expect(result.recordCount).toBe(31 * 16 * 2);
  });

  it('reads a bare export.xml', async () => {
    expect((await readAppleHealthExport(asFile(strToU8(xml), 'export.xml'))).days).toEqual(expected);
  });

  it('explains when a ZIP has no export.xml', async () => {
    await expect(readAppleHealthExport(asFile(zipSync({ 'notes.txt': strToU8('hi') }), 'photos.zip'))).rejects.toThrow('export.xml');
  });
});
