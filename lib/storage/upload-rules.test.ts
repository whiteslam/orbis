import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MAX_UPLOAD_BYTES, isStagedPath, uploadProblem } from './upload-rules';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const user = '11111111-2222-3333-4444-555555555555';
const object = '0f8fad5b-d9cb-469f-a165-70867728950e';

test('accepts xlsx and pdf up to 100 MB, whatever type the browser reports', () => {
  assert.equal(uploadProblem({ name: 'Report.PDF', type: 'application/pdf', size: 10 }), null);
  assert.equal(uploadProblem({ name: 'book.xlsx', type: XLSX, size: MAX_UPLOAD_BYTES }), null);
  assert.equal(uploadProblem({ name: 'book.xlsx', type: '', size: 10 }), null);
  assert.equal(uploadProblem({ name: 'book.xlsx', type: 'application/octet-stream', size: 10 }), null);
});

test('refuses other file types, empty and oversized files', () => {
  assert.match(uploadProblem({ name: 'data.csv', type: 'text/csv', size: 10 }) ?? '', /xlsx/);
  assert.match(uploadProblem({ name: 'book.xls', type: 'application/vnd.ms-excel', size: 10 }) ?? '', /xlsx/);
  assert.match(uploadProblem({ name: 'a.pdf', type: 'application/pdf', size: 0 }) ?? '', /empty/);
  assert.match(uploadProblem({ name: 'a.pdf', type: 'application/pdf', size: MAX_UPLOAD_BYTES + 1 }) ?? '', /100 MB/);
  assert.ok(uploadProblem(null));
});

test('only a server-shaped path under this user counts as staged', () => {
  assert.equal(isStagedPath(user, `${user}/${object}.pdf`), true);
  assert.equal(isStagedPath(user, `99999999-2222-3333-4444-555555555555/${object}.pdf`), false);
  assert.equal(isStagedPath(user, `${user}/../x/${object}.pdf`), false);
  assert.equal(isStagedPath(user, `${user}/${object}.exe`), false);
  assert.equal(isStagedPath(user, 42), false);
});
