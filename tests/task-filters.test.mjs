import assert from 'node:assert/strict';
import test from 'node:test';
import { capitalizeLines, emptyFilters, filterTasks, localDateBoundary, matchesSearch, parsePreferences } from '../lib/client/task-filters.ts';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const task = {
  id: firstId, title: 'Подготовить отчёт по проекту', description: 'Обсудить бюджет\nRésumé встречи',
  priority: 'high', completed: false, cancelled: false,
  createdAt: new Date(2026, 10, 12, 12).toISOString(), dueDate: '2026-11-20',
};

test('search matches partial words across title and note regardless of case, accents or ё', () => {
  assert.equal(matchesSearch(task, 'ОТЧЕТ бюд'), true);
  assert.equal(matchesSearch(task, 'resume'), true);
  assert.equal(matchesSearch(task, 'отчет отпуск'), false);
});

test('search keeps matching completed/cancelled and pinned renamed tasks until query is cleared', () => {
  const filters = { ...emptyFilters, status: 'active' };
  const completed = { ...task, completed: true };
  const cancelled = { ...task, cancelled: true, title: 'Изменённое название', description: '' };
  const irrelevant = { ...task, id: secondId, title: 'Другая задача', description: '' };
  assert.deepEqual(filterTasks([completed, irrelevant], filters, 'отчет', []).map(item => item.id), [firstId]);
  assert.deepEqual(filterTasks([cancelled, irrelevant], filters, 'отчет', [firstId]).map(item => item.id), [firstId]);
  assert.deepEqual(filterTasks([cancelled], filters, '', [firstId]), []);
});

test('priority, inclusive creation dates and deadlines combine without including tasks with no deadline', () => {
  const filters = { ...emptyFilters, priority: 'high', createdFrom: '2026-11-12', createdTo: '2026-11-12', dueFrom: '2026-11-20', dueTo: '2026-11-20' };
  const tasks = [task, { ...task, id: secondId, dueDate: null }, { ...task, id: 'low', priority: 'low' }];
  assert.deepEqual(filterTasks(tasks, filters, '', []).map(item => item.id), [firstId]);
  assert.deepEqual(filterTasks(tasks, { ...filters, dueFrom: '2026-11-21', dueTo: '2026-11-22' }, '', []), []);
});

test('saved query, matching IDs and filters roundtrip while malformed preferences are ignored', () => {
  const preferences = { query: 'отчёт', pinnedIds: [firstId], filters: { ...emptyFilters, status: 'cancelled' } };
  assert.deepEqual(parsePreferences(JSON.stringify(preferences)), preferences);
  assert.deepEqual(parsePreferences('{broken').filters, emptyFilters);
  const invalid = parsePreferences(JSON.stringify({ query: 123, pinnedIds: ['bad'], filters: { status: 'unknown', dueFrom: '2026-02-30' } }));
  assert.equal(invalid.query, '');
  assert.deepEqual(invalid.pinnedIds, []);
  assert.deepEqual(invalid.filters, emptyFilters);
});

test('history bounds include the entire local day and note lines start with capital letters', () => {
  assert.equal(localDateBoundary('2026-11-12'), new Date(2026, 10, 12).toISOString());
  assert.equal(localDateBoundary('2026-11-12', true), new Date(2026, 10, 13).toISOString());
  assert.equal(capitalizeLines('первая строка\n  вторая строка\n- третья\n'), 'Первая строка\n  Вторая строка\n- Третья\n');
});
