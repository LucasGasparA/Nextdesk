import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_STATUS, buildQueueQueries, sortQueue } from '../src/queue.js';

test('OPEN_STATUS é 2', () => {
  assert.equal(OPEN_STATUS, 2);
});

test('buildQueueQueries monta as duas buscas do filtro', () => {
  assert.deepEqual(buildQueueQueries(5, 9), {
    unassigned: 'group_id:5 AND agent_id:null AND status:2',
    mine: 'group_id:5 AND agent_id:9 AND status:2',
  });
});

test('sortQueue mantém só abertos, do mais antigo ao mais novo, sem mutar', () => {
  const tickets = [
    { id: 1, status: 2, created_at: '2026-09-29T10:00:00Z' },
    { id: 2, status: 4, created_at: '2026-09-28T10:00:00Z' },
    { id: 3, status: 2, created_at: '2026-09-27T10:00:00Z' },
  ];
  assert.deepEqual(sortQueue(tickets).map((t) => t.id), [3, 1]);
  assert.deepEqual(tickets.map((t) => t.id), [1, 2, 3]);
});
