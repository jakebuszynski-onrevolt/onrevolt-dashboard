import assert from 'node:assert/strict';
import test from 'node:test';
import { activeServiceStatusValue, activeServiceWithoutTasksStatusValue, matchesClientProjectFilter, projectForClientFilter } from './client-project-filter';

const lead = { status: 'LEAD', stage: { id: 'lead' } };
const service = { status: 'W_TRAKCIE_OBSLUGI', stage: { id: 'service' } };
const visit = { status: 'W_TRAKCIE_OBSLUGI', stage: { id: 'visit' } };

test('specific stages sharing a status stay separate', () => {
  assert.equal(matchesClientProjectFilter({ projects: [service] }, 'stage:visit'), false);
  assert.equal(matchesClientProjectFilter({ projects: [visit] }, 'stage:visit'), true);
  assert.equal(matchesClientProjectFilter({ projects: [visit] }, 'stage:service'), false);
});

test('default service filter excludes leads and clients without projects', () => {
  assert.equal(matchesClientProjectFilter({ projects: [lead] }, activeServiceStatusValue), false);
  assert.equal(matchesClientProjectFilter({ projects: [] }, activeServiceStatusValue), false);
  assert.equal(matchesClientProjectFilter({ projects: [lead, visit] }, activeServiceStatusValue), true);
  assert.equal(matchesClientProjectFilter({ projects: [lead] }, 'all'), true);
});

test('displayed project is the one matching selected stage, even when it is not first', () => {
  assert.equal(projectForClientFilter([lead, service, visit], 'stage:visit'), visit);
  assert.equal(projectForClientFilter([lead, visit], activeServiceStatusValue), visit);
  assert.equal(projectForClientFilter([lead, visit], 'all'), lead);
});

test('service without tasks preserves client and project task exclusions', () => {
  assert.equal(matchesClientProjectFilter({ projects: [visit] }, activeServiceWithoutTasksStatusValue), true);
  assert.equal(matchesClientProjectFilter({ projects: [visit], _count: { tasks: 1 } }, activeServiceWithoutTasksStatusValue), false);
  assert.equal(matchesClientProjectFilter({ projects: [{ ...visit, _count: { tasks: 1 } }] }, activeServiceWithoutTasksStatusValue), false);
  assert.equal(matchesClientProjectFilter({ projects: [{ status: 'ZAKONCZONY' }] }, activeServiceWithoutTasksStatusValue), false);
});
