// pdfjs-dist ships no types for its worker entry; the app only registers it for pdfjs to use.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
