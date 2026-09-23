export type WorkbookObservation = {
  id: string;
  sheet: string;
  column: string;
  label: string;
  value: string;
};

export type WorkbookSheetPreview = {
  name: string;
  rowCount: number;
  columnCount: number;
  columns: string[];
  previewRows: Array<{ rowNumber: number; values: string[] }>;
};

export type ParsedWorkbookPreview = {
  fileName: string;
  sheets: WorkbookSheetPreview[];
  observations: WorkbookObservation[];
};

export type WorkbookPreview = ParsedWorkbookPreview & { verificationToken: string };

export type WorkbookAdvice = {
  summary: string;
  advice: Array<{ title: string; action: string; evidenceIds: string[] }>;
  caveats: string[];
};

export type WorkbookActionResult<T> =
  | { success: true; data: T }
  | { success: false; message: string };
