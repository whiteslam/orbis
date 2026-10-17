// Streams an Apple Health export (export.zip or export.xml) and returns daily step totals.
// Runs in the browser's Web Worker; nothing here touches the network.

import { Unzip, UnzipInflate, type UnzipFile } from 'fflate';
import { scanStepRecords, StepAggregator, type StepImportResult } from '@/lib/health/apple-steps';

export type ExportProgress = { stage: string; fraction: number };

class XmlStepReader {
  private readonly decoder = new TextDecoder();
  private carry = '';
  readonly aggregator = new StepAggregator();

  push(bytes: Uint8Array, final: boolean) {
    const scanned = scanStepRecords(this.decoder.decode(bytes, { stream: !final }), this.carry);
    // A well-formed tag is a few hundred bytes; a huge carry means this isn't Health XML.
    this.carry = scanned.carry.length > 1_000_000 ? '' : scanned.carry;
    for (const sample of scanned.samples) this.aggregator.add(sample);
  }
}

type ZipState = { foundXml: boolean; finished: boolean; failure: Error | null };

/** Unzips an export, feeding only export.xml to the reader and noting what it saw in `state`. */
function exportUnzipper(reader: XmlStepReader, state: ZipState) {
  const unzip = new Unzip((entry: UnzipFile) => {
    // Only export.xml holds the samples; skip export_cda.xml, workout routes and ECGs.
    if (!/(^|\/)export\.xml$/.test(entry.name)) return;
    state.foundXml = true;
    entry.ondata = (error, data, final) => {
      if (error) state.failure = error;
      else {
        reader.push(data, final);
        if (final) state.finished = true;
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  return unzip;
}

/** Streams the file into `push`, calling `afterChunk` with the bytes read so far after each chunk. */
async function streamFile(file: Blob, push: (bytes: Uint8Array, final: boolean) => void, afterChunk: (read: number) => void) {
  const stream = file.stream().getReader();
  let read = 0;
  for (;;) {
    const { value, done } = await stream.read();
    if (done) {
      push(new Uint8Array(0), true);
      return;
    }
    read += value.byteLength;
    push(value, false);
    afterChunk(read);
  }
}

export async function readAppleHealthExport(file: Blob & { name: string }, onProgress: (progress: ExportProgress) => void = () => {}): Promise<StepImportResult> {
  const reader = new XmlStepReader();
  const isZip = /\.zip$/i.test(file.name);
  const state: ZipState = { foundXml: !isZip, finished: !isZip, failure: null };
  const unzip = isZip ? exportUnzipper(reader, state) : null;

  let lastReported = 0;
  await streamFile(
    file,
    (bytes, final) => (unzip ? unzip.push(bytes, final) : reader.push(bytes, final)),
    (read) => {
      if (state.failure) throw state.failure;
      if (read - lastReported > 8_000_000) {
        lastReported = read;
        onProgress({ stage: reader.aggregator.recordCount ? 'Finding step records…' : 'Reading Health data…', fraction: read / file.size });
      }
    },
  );

  if (state.failure) throw state.failure;
  if (!state.foundXml) throw new Error('This ZIP doesn’t contain export.xml. Unzip it and upload apple_health_export/export.xml instead.');
  if (!state.finished) throw new Error('The export ended early. Unzip it and upload apple_health_export/export.xml instead.');
  onProgress({ stage: 'Aggregating daily totals…', fraction: 1 });
  return reader.aggregator.result();
}
