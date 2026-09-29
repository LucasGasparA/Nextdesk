import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, ApiError } from '../src/api.js';

const BASE = 'https://ajuda.nextfit.com.br/api/v2';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, ...init });
    return handler(url, init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

const client = (fetchFn) => createClient({ domain: 'ajuda.nextfit.com.br', apiKey: 'chave-teste', fetchFn });

test('envia autenticação Basic com a chave e X', async () => {
  const f = fakeFetch(() => json({ id: 9 }));
  const me = await client(f).me();
  assert.equal(me.id, 9);
  assert.equal(f.calls[0].url, `${BASE}/agents/me`);
  assert.equal(f.calls[0].method, 'GET');
  assert.equal(f.calls[0].headers.Authorization, 'Basic ' + btoa('chave-teste:X'));
});

test('401 vira ApiError com status 401', async () => {
  const c = client(fakeFetch(() => json({ code: 'invalid_credentials' }, 401)));
  await assert.rejects(c.me(), (e) => e instanceof ApiError && e.status === 401 && e.message === 'Chave de API inválida.');
});

test('429 informa o Retry-After', async () => {
  const c = client(fakeFetch(() => json({}, 429, { 'Retry-After': '30' })));
  await assert.rejects(c.me(), (e) => e.status === 429 && e.retryAfter === 30 && /30s/.test(e.message));
});

test('resposta não JSON explica que o domínio não é a API e sugere freshdesk.com', async () => {
  const c = client(fakeFetch(() => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })));
  await assert.rejects(c.me(), (e) => e instanceof ApiError && /ajuda\.nextfit\.com\.br/.test(e.message) && /freshdesk\.com/.test(e.message));
});

test('falha de rede vira ApiError com status 0', async () => {
  const c = client(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(c.me(), (e) => e instanceof ApiError && e.status === 0);
});

test('erro de validação traz os detalhes dos campos', async () => {
  const c = client(fakeFetch(() => json({ description: 'Validation failed', errors: [{ field: 'type', message: 'It should be one of these values' }] }, 400)));
  await assert.rejects(c.updateTicket(1, { status: 3 }), (e) => e.status === 400 && /type: It should be one of these values/.test(e.message));
});

test('searchTickets codifica a query e pagina até a página incompleta', async () => {
  const page = (n, count) => ({ total: 45, results: Array.from({ length: count }, (_, i) => ({ id: n * 100 + i })) });
  const f = fakeFetch((url, init, call) => json(call === 1 ? page(1, 30) : page(2, 15)));
  const results = await client(f).searchTickets('group_id:5 AND agent_id:null AND status:2');
  assert.equal(results.length, 45);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, `${BASE}/search/tickets?query=%22group_id%3A5%20AND%20agent_id%3Anull%20AND%20status%3A2%22&page=1`);
  assert.match(f.calls[1].url, /&page=2$/);
});

test('searchTickets para na página 10', async () => {
  const f = fakeFetch(() => json({ total: 400, results: Array.from({ length: 30 }, (_, i) => ({ id: i })) }));
  await client(f).searchTickets('status:2');
  assert.equal(f.calls.length, 10);
});

test('listas paginam com per_page=100', async () => {
  const f = fakeFetch((url, init, call) => json(Array.from({ length: call === 1 ? 100 : 3 }, (_, i) => ({ id: i }))));
  const agents = await client(f).agents();
  assert.equal(agents.length, 103);
  assert.equal(f.calls[0].url, `${BASE}/agents?per_page=100&page=1`);
  assert.equal(f.calls[1].url, `${BASE}/agents?per_page=100&page=2`);
});

test('leituras usam os caminhos corretos', async () => {
  const f = fakeFetch((url) => json(url.includes('conversations') ? [] : {}));
  const c = client(f);
  await c.ticket(7);
  await c.conversations(7);
  await c.contact(50);
  await c.group(5);
  await c.ticketFields();
  await c.cannedFolders();
  await c.cannedResponses(10);
  await c.cannedResponse(100);
  assert.deepEqual(f.calls.map((call) => call.url.replace(BASE, '')), [
    '/tickets/7?include=requester',
    '/tickets/7/conversations?per_page=100&page=1',
    '/contacts/50',
    '/groups/5',
    '/ticket_fields',
    '/canned_response_folders',
    '/canned_response_folders/10/responses',
    '/canned_responses/100',
  ]);
});

test('reply, note e updateTicket enviam método e corpo corretos', async () => {
  const f = fakeFetch(() => json({}, 201));
  const c = client(f);
  await c.reply(7, 'Olá');
  await c.note(7, 'Interno');
  await c.updateTicket(7, { responder_id: 3 });
  assert.deepEqual(
    f.calls.map((call) => [call.method, call.url.replace(BASE, ''), JSON.parse(call.body)]),
    [
      ['POST', '/tickets/7/reply', { body: 'Olá' }],
      ['POST', '/tickets/7/notes', { body: 'Interno', private: true }],
      ['PUT', '/tickets/7', { responder_id: 3 }],
    ],
  );
});

test('redirecionamento para outro domínio explica o domínio em vez de culpar a chave', async () => {
  const redirected = {
    status: 401,
    ok: false,
    redirected: true,
    url: 'https://nextfit.freshdesk.com/api/v2/agents/me',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    json: async () => ({}),
  };
  const c = client(fakeFetch(() => redirected));
  await assert.rejects(c.me(), (e) => e instanceof ApiError && e.status !== 401 && /nextfit\.freshdesk\.com/.test(e.message));
});

test('404 com corpo vazio explica que o domínio não serve a API', async () => {
  const c = client(fakeFetch(() => new Response('', { status: 404, headers: { 'Content-Type': 'application/json' } })));
  await assert.rejects(c.me(), (e) => e instanceof ApiError && e.status === 404 && /não respondeu como a API/.test(e.message));
});

test('resposta de sucesso sem corpo não quebra', async () => {
  const c = client(fakeFetch(() => new Response(null, { status: 204, headers: { 'Content-Type': 'application/json' } })));
  assert.equal(await c.updateTicket(1, { status: 3 }), null);
});
