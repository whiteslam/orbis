import { describe, expect, it } from 'vitest';
import { parseAppleDate, scanStepRecords, StepAggregator } from './apple-steps';
import { stepContext } from './steps-stats';

const record = (source: string, start: string, end: string, value: number) =>
  `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="${source}" sourceVersion="17.0" unit="count" creationDate="${end}" startDate="${start}" endDate="${end}" value="${value}"/>\n`;

function aggregate(xml: string, chunkSize = xml.length) {
  const aggregator = new StepAggregator();
  let carry = '';
  for (let i = 0; i < xml.length; i += chunkSize) {
    const scanned = scanStepRecords(xml.slice(i, i + chunkSize), carry);
    carry = scanned.carry;
    scanned.samples.forEach((sample) => aggregator.add(sample));
  }
  return aggregator.result();
}

describe('scanStepRecords', () => {
  it('ignores other record types and the DTD', () => {
    const xml = `<!ATTLIST Record type CDATA #REQUIRED>\n<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" startDate="2026-09-21 08:00:00 +0530" endDate="2026-09-21 08:00:00 +0530" value="72"/>\n${record('iPhone', '2026-09-21 08:00:00 +0530', '2026-09-21 08:10:00 +0530', 500)}`;
    expect(scanStepRecords(xml, '').samples).toEqual([{ source: 'iPhone', start: '2026-09-21 08:00:00 +0530', end: '2026-09-21 08:10:00 +0530', value: 500 }]);
  });

  it('reads records with child elements', () => {
    const xml = `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" startDate="2026-09-21 08:00:00 +0530" endDate="2026-09-21 08:10:00 +0530" value="42">\n<MetadataEntry key="HKWasUserEntered" value="1"/>\n</Record>`;
    expect(scanStepRecords(xml, '').samples).toHaveLength(1);
  });

  it('handles tags split across every possible chunk boundary', () => {
    const xml = record('iPhone', '2026-09-21 08:00:00 +0530', '2026-09-21 08:10:00 +0530', 500) + record('iPhone', '2026-09-22 09:00:00 +0530', '2026-09-22 09:10:00 +0530', 300);
    for (const size of [1, 7, 13, 40, 97]) {
      expect(aggregate(xml, size).days).toEqual([{ date: '2026-09-21', steps: 500 }, { date: '2026-09-22', steps: 300 }]);
    }
  });
});

describe('StepAggregator', () => {
  it('keeps the larger source in an hour instead of summing iPhone and Watch', () => {
    const xml =
      record('iPhone', '2026-09-21 08:00:00 +0530', '2026-09-21 08:30:00 +0530', 1000) +
      record('Apple Watch', '2026-09-21 08:00:00 +0530', '2026-09-21 08:15:00 +0530', 600) +
      record('Apple Watch', '2026-09-21 08:15:00 +0530', '2026-09-21 08:30:00 +0530', 500) +
      record('iPhone', '2026-09-21 12:00:00 +0530', '2026-09-21 12:10:00 +0530', 200);
    expect(aggregate(xml).days).toEqual([{ date: '2026-09-21', steps: 1300 }]);
  });

  it('splits a sample across hours in proportion to time', () => {
    const xml =
      record('iPhone', '2026-09-21 08:45:00 +0530', '2026-09-21 09:15:00 +0530', 600) +
      record('Apple Watch', '2026-09-21 09:00:00 +0530', '2026-09-21 09:15:00 +0530', 400);
    // 08:xx → iPhone 300; 09:xx → max(iPhone 300, Watch 400) = 400
    expect(aggregate(xml).days).toEqual([{ date: '2026-09-21', steps: 700 }]);
  });

  it('splits a sample that crosses midnight between days', () => {
    const xml = record('iPhone', '2026-09-21 23:50:00 +0530', '2026-09-22 00:10:00 +0530', 200);
    expect(aggregate(xml).days).toEqual([{ date: '2026-09-21', steps: 100 }, { date: '2026-09-22', steps: 100 }]);
  });

  it('uses the wall clock of each sample, whatever its offset', () => {
    const xml =
      record('iPhone', '2026-09-21 23:30:00 -0700', '2026-09-21 23:40:00 -0700', 100) +
      record('iPhone', '2026-09-22 00:30:00 +0100', '2026-09-22 00:40:00 +0100', 50);
    expect(aggregate(xml).days).toEqual([{ date: '2026-09-21', steps: 100 }, { date: '2026-09-22', steps: 50 }]);
  });

  it('reports record counts and the date range', () => {
    const result = aggregate(record('iPhone', '2026-09-20 08:00:00 +0530', '2026-09-20 08:10:00 +0530', 10) + record('iPhone', '2026-09-23 08:00:00 +0530', '2026-09-23 08:10:00 +0530', 20));
    expect(result).toMatchObject({ recordCount: 2, firstDate: '2026-09-20', lastDate: '2026-09-23' });
  });
});

describe('parseAppleDate', () => {
  it('rejects malformed dates', () => {
    expect(parseAppleDate('yesterday')).toBeNull();
    expect(parseAppleDate('2026-09-21 08:00:00 +0530')).toEqual({ local: Date.UTC(2026, 8, 21, 8), instant: Date.UTC(2026, 8, 21, 2, 30) });
  });
});

describe('stepContext', () => {
  it('averages over the windows ending at the latest imported day', () => {
    const days = Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10), steps: i < 30 ? 5000 : 6000 }));
    expect(stepContext(days)).toMatchObject({ latestDate: '2026-08-29', average7: 6000, average30: 6000, trendVsPrevious30: '+20%' });
    expect(stepContext(days).last14Days).toHaveLength(14);
  });
});
