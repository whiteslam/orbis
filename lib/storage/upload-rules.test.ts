import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MAX_CAREER_UPLOAD_BYTES, MAX_UPLOAD_BYTES, careerResumePath, careerUploadExtension, isCareerResumePath, careerUploadProblem, contentTypeFor, isStagedPath, stagedInput, uploadExtension, uploadProblem } from './upload-rules';

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

test('an action input is accepted only for a staged path of this user', () => {
  assert.deepEqual(stagedInput(user, { path: `${user}/${object}.xlsx`, name: 'Book.xlsx' }), { path: `${user}/${object}.xlsx`, name: 'Book.xlsx' });
  assert.deepEqual(stagedInput(user, { path: `${user}/${object}.pdf` }), { path: `${user}/${object}.pdf`, name: '' });
  assert.equal(stagedInput(user, { path: `99999999-2222-3333-4444-555555555555/${object}.pdf`, name: 'x.pdf' }), null);
  assert.equal(stagedInput(user, { path: `${user}/other.pdf`, name: 'x.pdf' }), null);
  assert.equal(stagedInput(user, null), null);
  assert.equal(stagedInput(user, `${user}/${object}.pdf`), null);
});

test('career documents accept pdf and docx up to 10 MB', () => {
  assert.equal(careerUploadExtension('CV.DOCX'), 'docx');
  assert.equal(careerUploadExtension('cv.pdf'), 'pdf');
  assert.equal(careerUploadExtension('cv.doc'), null);
  assert.equal(careerUploadExtension(undefined), null);
  assert.equal(careerUploadProblem({ name: 'cv.docx', type: '', size: 10 }), null);
  assert.equal(careerUploadProblem({ name: 'cv.pdf', type: 'application/pdf', size: MAX_CAREER_UPLOAD_BYTES }), null);
  assert.match(careerUploadProblem({ name: 'cv.doc', type: 'application/msword', size: 10 }) ?? '', /docx/);
  assert.match(careerUploadProblem({ name: 'cv.pdf', type: 'application/pdf', size: 0 }) ?? '', /empty/);
  assert.match(careerUploadProblem({ name: 'cv.pdf', type: 'application/pdf', size: MAX_CAREER_UPLOAD_BYTES + 1 }) ?? '', /10 MB/);
  assert.ok(careerUploadProblem(null));
  assert.equal(contentTypeFor('docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('a staged upload still refuses docx: only the career bucket takes it', () => {
  assert.equal(uploadExtension('cv.docx'), null);
  assert.match(uploadProblem({ name: 'cv.docx', type: '', size: 10 }) ?? '', /xlsx/);
  assert.equal(isStagedPath(user, `${user}/${object}.docx`), false);
});

test('a career resume path is the server-picked one in the user resume folder', () => {
  const path = careerResumePath(user, object, 'docx');
  assert.equal(path, `${user}/resume/${object}.docx`);
  assert.equal(isCareerResumePath(user, path), true);
  assert.equal(isCareerResumePath(user, `${user}/resume/${object}.pdf`), true);
  assert.equal(isCareerResumePath(user, `${user}/${object}.pdf`), false);
  assert.equal(isCareerResumePath(user, `${user}/resume/../${object}.pdf`), false);
  assert.equal(isCareerResumePath(user, `${user}/resume/${object}.xlsx`), false);
  assert.equal(isCareerResumePath(user, `99999999-2222-3333-4444-555555555555/resume/${object}.pdf`), false);
  assert.equal(isCareerResumePath(user, null), false);
});
