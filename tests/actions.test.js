import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_NAME, discoverSetup, loadReference, loadQueue, loadTicket, saveTicket } from '../src/actions.js';

function fakeClient(overrides = {}) {
  const calls = [];
  const base = {
    me: async () => ({ id: 9 }),
    groups: async () => [{ id: 1, name: 'Financeiro' }, { id: 5, name: 'CSM - Engajamento ' }],
    group: async () => ({ id: 5, agent_ids: [9, 3] }),
    agents: async () => [
      { id: 3, contact: { name: 'Bruno' } },
      { id: 9, contact: { name: 'Ana' } },
      { id: 4, contact: { name: 'Fora do grupo' } },
    ],
    ticketFields: async () => [
      { name: 'status', choices: { 2: ['Aberto', 'Em andamento'] } },
      { name: 'ticket_type', choices: ['Dúvida'] },
    ],
    cannedFolders: async () => [{ id: 10, name: 'Geral' }],
    cannedResponses: async () => [{ id: 100, title: 'Boas-vindas' }],
    searchTickets: async (query) => {
      calls.push(['search', query]);
      return query.includes('agent_id:null')
        ? [
            { id: 1, status: 2, requester_id: 50, created_at: '2026-09-29T10:00:00Z' },
            { id: 3, status: 2, requester_id: 52, created_at: '2026-09-27T10:00:00Z' },
          ]
        : [{ id: 2, status: 2, requester_id: 51, created_at: '2026-09-28T10:00:00Z' }];
    },
    contact: async (id) => {
      calls.push(['contact', id]);
      if (id === 51) throw new Error('404');
      return { id, name: `Cliente ${id}` };
    },
    ticket: async (id) => ({
      id,
      requester_id: 50,
      created_at: '2026-09-29T10:00:00Z',
      description_text: 'Preciso de ajuda',
      requester: { name: 'Maria' },
    }),
    conversations: async () => [
      { id: 12, incoming: false, private: true, user_id: 3, body_text: 'Nota', created_at: '2026-09-29T13:00:00Z' },
      { id: 11, incoming: true, private: false, user_id: 50, body_text: 'Obrigada', created_at: '2026-09-29T12:00:00Z' },
      { id: 10, incoming: false, private: false, user_id: 9, body_text: 'Resposta', created_at: '2026-09-29T11:00:00Z' },
    ],
    reply: async (...args) => { calls.push(['reply', ...args]); },
    note: async (...args) => { calls.push(['note', ...args]); },
    updateTicket: async (...args) => { calls.push(['update', ...args]); },
  };
  return { ...base, ...overrides, calls };
}

test('GROUP_NAME é CSM - Engajamento', () => {
  assert.equal(GROUP_NAME, 'CSM - Engajamento');
});

test('discoverSetup encontra meu ID e o grupo ignorando espaços e maiúsculas', async () => {
  assert.deepEqual(await discoverSetup(fakeClient()), { meId: 9, groupId: 5 });
  assert.deepEqual(await discoverSetup(fakeClient(), 'csm - engajamento'), { meId: 9, groupId: 5 });
});

test('discoverSetup falha quando o grupo não existe', async () => {
  const client = fakeClient({ groups: async () => [{ id: 1, name: 'Financeiro' }] });
  await assert.rejects(discoverSetup(client), /Grupo "CSM - Engajamento" não encontrado no Freshdesk\./);
});

test('loadReference traz só agentes do grupo, ordenados, e campos e respostas prontas', async () => {
  assert.deepEqual(await loadReference(fakeClient(), 5), {
    agents: [{ id: 9, name: 'Ana' }, { id: 3, name: 'Bruno' }],
    statuses: [{ value: 2, label: 'Aberto' }],
    types: ['Dúvida'],
    canned: [{ id: 100, title: 'Boas-vindas', folder: 'Geral' }],
  });
});

test('loadQueue busca os dois blocos, ordena e resolve nomes tolerando falhas', async () => {
  const client = fakeClient();
  const queue = await loadQueue(client, { groupId: 5, meId: 9 }, { 52: 'Já conhecido' });
  assert.deepEqual(queue.unassigned.map((t) => t.id), [3, 1]);
  assert.deepEqual(queue.mine.map((t) => t.id), [2]);
  assert.deepEqual(queue.names, { 50: 'Cliente 50', 52: 'Já conhecido' });
  assert.deepEqual(client.calls.filter((c) => c[0] === 'search').map((c) => c[1]).sort(), [
    'group_id:5 AND agent_id:9 AND status:2',
    'group_id:5 AND agent_id:null AND status:2',
  ]);
  assert.deepEqual(client.calls.filter((c) => c[0] === 'contact').map((c) => c[1]).sort(), [50, 51]);
});

test('loadTicket monta a conversa em ordem com nomes', async () => {
  const { ticket, messages } = await loadTicket(fakeClient(), 7, [{ id: 9, name: 'Ana' }, { id: 3, name: 'Bruno' }]);
  assert.equal(ticket.id, 7);
  assert.deepEqual(messages.map((m) => [m.from, m.text, m.private, m.incoming]), [
    ['Maria', 'Preciso de ajuda', false, true],
    ['Ana', 'Resposta', false, false],
    ['Maria', 'Obrigada', false, true],
    ['Bruno', 'Nota', true, false],
  ]);
});

test('loadTicket usa "Agente" para autor desconhecido', async () => {
  const { messages } = await loadTicket(fakeClient(), 7);
  assert.equal(messages[1].from, 'Agente');
});

test('saveTicket só responde quando não há alterações, com texto escapado', async () => {
  const client = fakeClient();
  const result = await saveTicket(client, { ticketId: 7, mode: 'reply', text: 'Olá <3\nAbraço', changes: {} });
  assert.deepEqual(result, { sent: true, updated: false });
  assert.deepEqual(client.calls, [['reply', 7, 'Olá &lt;3<br>Abraço']]);
});

test('saveTicket envia nota e depois atualiza os campos', async () => {
  const client = fakeClient();
  const result = await saveTicket(client, { ticketId: 7, mode: 'note', text: 'Com você, Bruno', changes: { responder_id: 3 } });
  assert.deepEqual(result, { sent: true, updated: true });
  assert.deepEqual(client.calls, [['note', 7, 'Com você, Bruno'], ['update', 7, { responder_id: 3 }]]);
});

test('saveTicket só atualiza quando não há texto', async () => {
  const client = fakeClient();
  const result = await saveTicket(client, { ticketId: 7, mode: 'reply', text: '  ', changes: { status: 3 } });
  assert.deepEqual(result, { sent: false, updated: true });
  assert.deepEqual(client.calls, [['update', 7, { status: 3 }]]);
});

test('saveTicket devolve o erro se a atualização falhar depois do envio', async () => {
  const client = fakeClient({ updateTicket: async () => { throw new Error('Erro 400'); } });
  const result = await saveTicket(client, { ticketId: 7, mode: 'reply', text: 'Olá', changes: { status: 3 } });
  assert.equal(result.sent, true);
  assert.equal(result.updated, false);
  assert.equal(result.error.message, 'Erro 400');
});

test('saveTicket não atualiza se o envio falhar', async () => {
  const client = fakeClient({ reply: async () => { throw new Error('offline'); } });
  await assert.rejects(saveTicket(client, { ticketId: 7, mode: 'reply', text: 'Olá', changes: { status: 3 } }), /offline/);
  assert.deepEqual(client.calls, []);
});

test('saveTicket propaga o erro quando só atualiza', async () => {
  const client = fakeClient({ updateTicket: async () => { throw new Error('Erro 400'); } });
  await assert.rejects(saveTicket(client, { ticketId: 7, mode: 'reply', text: '', changes: { status: 3 } }), /Erro 400/);
});
