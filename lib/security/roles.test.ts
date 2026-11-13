import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import { parseRole } from './role.ts';
import { researchDeskAllowed, researchDeskAvailable } from '../research/access.ts';

const saved = process.env.ORBIS_RESEARCH_DESK_EMAILS;
afterEach(() => {
  if (saved === undefined) delete process.env.ORBIS_RESEARCH_DESK_EMAILS;
  else process.env.ORBIS_RESEARCH_DESK_EMAILS = saved;
});

test('parseRole keeps the known roles and turns anything else into user', () => {
  assert.equal(parseRole('owner'), 'owner');
  assert.equal(parseRole('admin'), 'admin');
  assert.equal(parseRole('user'), 'user');
  assert.equal(parseRole('root'), 'user');
  assert.equal(parseRole('OWNER'), 'user');
  assert.equal(parseRole(null), 'user');
  assert.equal(parseRole(undefined), 'user');
  assert.equal(parseRole(7), 'user');
});

test('the owner role opens the Research desk with no email at all', () => {
  delete process.env.ORBIS_RESEARCH_DESK_EMAILS;
  assert.equal(researchDeskAllowed('owner', null), true);
  assert.equal(researchDeskAllowed('owner', undefined), true);
});

test('anyone else is shut out while no address is listed', () => {
  delete process.env.ORBIS_RESEARCH_DESK_EMAILS;
  assert.equal(researchDeskAllowed('user', 'x@y.z'), false);
  assert.equal(researchDeskAllowed('admin', 'x@y.z'), false);
});

test('a listed address still gets the desk, as a fallback to the role', () => {
  process.env.ORBIS_RESEARCH_DESK_EMAILS = 'x@y.z';
  assert.equal(researchDeskAllowed('user', 'x@y.z'), true);
  assert.equal(researchDeskAllowed('user', 'other@y.z'), false);
});

test('the desk shows only for the owner on a deployment whose worker is set up', () => {
  delete process.env.ORBIS_RESEARCH_DESK_EMAILS;
  assert.equal(researchDeskAvailable('owner', null, true), true);
  assert.equal(researchDeskAvailable('owner', null, false), false);
  assert.equal(researchDeskAvailable('user', 'x@y.z', true), false);
});
