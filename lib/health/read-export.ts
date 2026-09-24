// Streams an Apple Health export (export.zip or export.xml) and returns daily step totals.
// Runs in the browser's Web Worker; nothing here touches the network.

import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';
import { scanStepRecords, StepAggregator, type StepImportResult } from '@/lib/health/apple-steps';

export type ExportProgress = { stage: string; fraction: number };

class XmlStepReader {
  private decoder = new TextDecoder();
  private carry = '';
  readonly aggregator = new StepAggregator();

  push(bytes: Uint8Array, final: boolean) {
    const scanned = scanStepRecords(this.decoder.decode(bytes, { stream: !final }), this.carry);
    // A well-formed tag is a few hundred bytes; a huge carry means this isn't Health XML.
    this.carry = scanned.carry.length > 1_000_000 ? '' : scanned.carry;
    for (const sample of scanned.samples) this.aggregator.add(sample);
  }
}

export async function readAppleHealthExport(file: Blob & { name: string }, onProgress: (progress: ExportProgress) => void = () => {}): Promise<StepImportResult> {
  const reader = new XmlStepReader();
  const isZip = /\.zip$/i.test(file.name);
  let foundXml = !isZip;
  let finished = !isZip;
  let failure: Error | null = null;

  const unzip = isZip
    ? new Unzip((entry: UnzipFile) => {
        // Only export.xml holds the samples; skip export_cda.xml, workout routes and ECGs.
        if (!/(^|\/)export\.xml$/.test(entry.name)) return;
        foundXml = true;
        entry.ondata = (error, data, final) => {
          if (error) failure = error;
          else {
            reader.push(data, final);
            if (final) finished = true;
          }
        };
        entry.start();
      })
    : null;
  unzip?.register(UnzipInflate);

  const stream = file.stream().getReader();
  let read = 0;
  let lastReported = 0;
  for (;;) {
    const { value, done } = await stream.read();
    if (done) {
      if (unzip) unzip.push(new Uint8Array(0), true);
      else reader.push(new Uint8Array(0), true);
      break;
    }
    read += value.byteLength;
    if (unzip) unzip.push(value);
    else reader.push(value, false);
    if (failure) throw failure;
    if (read - lastReported > 8_000_000) {
      lastReported = read;
      onProgress({ stage: reader.aggregator.recordCount ? 'Finding step records…' : 'Reading Health data…', fraction: read / file.size });
    }
  }

  if (failure) throw failure;
  if (!foundXml) throw new Error('This ZIP doesn’t contain export.xml. Unzip it and upload apple_health_export/export.xml instead.');
  if (!finished) throw new Error('The export ended early. Unzip it and upload apple_health_export/export.xml instead.');
  onProgress({ stage: 'Aggregating daily totals…', fraction: 1 });
  return reader.aggregator.result();
}
