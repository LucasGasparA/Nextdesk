# NextDesk — Extensão Freshdesk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extensão de navegador (popup) que lista os tickets abertos do grupo CSM - Engajamento no Freshdesk e permite responder, deixar nota privada e alterar Status/Agente/Tipo sem abrir a ferramenta.

**Architecture:** Extensão Manifest V3 com popup em JavaScript puro (ES modules). Toda a lógica fica em módulos puros em `src/` (cliente HTTP com `fetch` injetável, regras de fila e de campos, formatação, storage com área injetável, fluxos em `actions.js`), testados com `node --test`. Só `src/popup.js` mexe no DOM e em `chrome.*`.

**Tech Stack:** JavaScript (ES2022, ES modules), Chrome/Edge Manifest V3, Freshdesk API v2, Node 24 (`node --test`, `node:assert/strict`). Sem dependências.

**Spec:** `docs/superpowers/specs/2026-09-29-nextdesk-extensao-freshdesk-design.md`

## Global Constraints

- Manifest V3; permissões: `storage`; `host_permissions`: `https://ajuda.nextfit.com.br/*` e `https://*.freshdesk.com/*`
- Sem build e sem dependências (nem de desenvolvimento); `package.json` só com `"type": "module"` e script de teste
- Grupo fixo: `CSM - Engajamento` (comparação sem diferenciar maiúsculas e ignorando espaços nas pontas)
- Fila: somente status `2` (Aberto); blocos "Sem responsável" (`agent_id:null`) e "Meus tickets" (`agent_id:<meu id>`); ordem do mais antigo para o mais novo
- Autenticação: `Authorization: Basic base64("<chave>:X")`
- Chave de API só em `chrome.storage.local`; nunca em código, log, teste ou commit
- Cache de agentes/campos/respostas prontas: 24 h
- Conversa exibida a partir de `body_text` via `textContent` (nunca `innerHTML` com dados do Freshdesk)
- Texto enviado: escapado e com quebras de linha → `<br>`
- Textos da interface em português do Brasil
- Nenhum envio real (resposta, nota, PUT) durante a implementação; só no teste manual, em ticket indicado pelo usuário

## Review Focus

1. **Agente, status ou tipo atual fora das listas** (ex.: ticket meu, mas não estou em `agent_ids` do grupo): o select precisa mostrar o valor atual, e Salvar sem mexer não pode desatribuir nem mudar nada → teste de `buildOptions` na Task 2.
2. **Ticket sem Tipo e o usuário só quer responder:** a resposta tem que sair sem exigir Tipo e sem PUT → testes de `validateSave` (Task 2) e `saveTicket` (Task 5).
3. **Texto com `<`, `&`, aspas e quebras de linha:** chega ao cliente como texto, sem virar HTML → testes de `textToHtml` (Task 1) e `saveTicket` (Task 5).
4. **Domínio colado com `https://` e caminho (ex.: a URL do filtro) ou domínio próprio que não serve a API:** o domínio é normalizado, e a resposta HTML vira mensagem clara sugerindo `*.freshdesk.com` → testes de `normalizeDomain` (Task 1) e de resposta não JSON (Task 3).
5. **Resposta pronta com placeholders `{{...}}`:** os conhecidos são preenchidos e os desconhecidos permanecem (o popup avisa) → teste de `fillPlaceholders` (Task 1).

---

### Task 1: Projeto base e formatação

**Files:**
- Create: `package.json`, `.gitignore`, `src/format.js`
- Test: `tests/format.test.js`

**Interfaces:**
- Consumes: nada
- Produces (`src/format.js`):
  - `escapeHtml(text: string): string`
  - `textToHtml(text: string): string` — trim, escape, `\r?\n` → `<br>`
  - `timeAgo(iso: string, now?: number): string` — `'agora' | 'há N min' | 'há N h' | 'há 1 dia' | 'há N dias'`
  - `normalizeDomain(value: string): string`
  - `fillPlaceholders(text: string, ticket: { id, subject?, requester?: { name? } }): string`

- [ ] **Step 1: Inicializar repositório e projeto**

```bash
git init -b main
```

Criar `package.json`:

```json
{
  "name": "nextdesk",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

Criar `.gitignore`:

```
node_modules/
*.zip
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `tests/format.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, textToHtml, timeAgo, normalizeDomain, fillPlaceholders } from '../src/format.js';

test('escapeHtml escapa caracteres especiais', () => {
  assert.equal(escapeHtml(`<b>"Tom" & 'Ana'</b>`), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Ana&#39;&lt;/b&gt;');
});

test('textToHtml escapa, apara e converte quebras de linha', () => {
  assert.equal(textToHtml('  Olá <cliente> & cia\r\nLinha 2\nLinha 3  '), 'Olá &lt;cliente&gt; &amp; cia<br>Linha 2<br>Linha 3');
});

test('timeAgo formata minutos, horas e dias', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  assert.equal(timeAgo('2026-09-29T11:59:40Z', now), 'agora');
  assert.equal(timeAgo('2026-09-29T11:15:00Z', now), 'há 45 min');
  assert.equal(timeAgo('2026-09-29T09:00:00Z', now), 'há 3 h');
  assert.equal(timeAgo('2026-09-28T11:00:00Z', now), 'há 1 dia');
  assert.equal(timeAgo('2026-09-25T12:00:00Z', now), 'há 4 dias');
});

test('timeAgo não mostra tempo negativo para datas futuras', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  assert.equal(timeAgo('2026-09-29T12:05:00Z', now), 'agora');
});

test('normalizeDomain remove protocolo, caminho, espaços e maiúsculas', () => {
  assert.equal(normalizeDomain(' https://ajuda.nextfit.com.br/a/tickets/filters/69000401702 '), 'ajuda.nextfit.com.br');
  assert.equal(normalizeDomain('nextfit.freshdesk.com'), 'nextfit.freshdesk.com');
  assert.equal(normalizeDomain('HTTP://Nextfit.Freshdesk.com/'), 'nextfit.freshdesk.com');
});

test('fillPlaceholders preenche campos conhecidos e mantém desconhecidos', () => {
  const ticket = { id: 42, subject: 'Acesso', requester: { name: 'Maria Souza' } };
  const text = 'Oi {{ticket.requester.firstname}} ({{ ticket.requester.name }}), ticket #{{ticket.id}} - {{ticket.subject}} {{ticket.agent.name}}';
  assert.equal(fillPlaceholders(text, ticket), 'Oi Maria (Maria Souza), ticket #42 - Acesso {{ticket.agent.name}}');
});

test('fillPlaceholders sem nome do cliente usa "cliente"', () => {
  assert.equal(fillPlaceholders('Olá {{ticket.requester.firstname}}', { id: 1 }), 'Olá cliente');
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test tests/format.test.js`
Expected: FAIL — `Cannot find module '.../src/format.js'`

- [ ] **Step 4: Implementar**

Criar `src/format.js`:

```js
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function textToHtml(text) {
  return escapeHtml(text.trim()).replace(/\r?\n/g, '<br>');
}

export function timeAgo(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

export function normalizeDomain(value) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export function fillPlaceholders(text, ticket) {
  const name = ticket.requester?.name?.trim() || 'cliente';
  const values = {
    'ticket.id': String(ticket.id),
    'ticket.subject': ticket.subject ?? '',
    'ticket.requester.name': name,
    'ticket.requester.firstname': name.split(/\s+/)[0],
  };
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => values[key] ?? match);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test tests/format.test.js`
Expected: PASS (7 testes)

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore src/format.js tests/format.test.js docs/
git commit -m "feat: projeto base e funções de formatação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regras de fila e de campos

**Files:**
- Create: `src/queue.js`, `src/fields.js`
- Test: `tests/queue.test.js`, `tests/fields.test.js`

**Interfaces:**
- Consumes: nada
- Produces:
  - `src/queue.js`:
    - `OPEN_STATUS = 2`
    - `buildQueueQueries(groupId: number, meId: number): { unassigned: string, mine: string }`
    - `sortQueue(tickets: Ticket[]): Ticket[]` — só `status === 2`, ordem por `created_at` crescente, sem mutar a entrada
  - `src/fields.js`:
    - `parseTicketFields(fields: object[]): { statuses: {value:number,label:string}[], types: string[] }`
    - `computeChanges(ticket: { status, responder_id, type }, form: { status:number, responderId:number|null, type:string }): { status?, responder_id?, type? }`
    - `validateSave({ text: string, changes: object, form: { type: string } }): { field: 'type'|null, message: string }[]`
    - `buildOptions(options: {value,label}[], current: any, unknownLabel?: (v) => string): { value: string, label: string, selected: boolean }[]`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/queue.test.js`:

```js
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
```

Criar `tests/fields.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTicketFields, computeChanges, validateSave, buildOptions } from '../src/fields.js';

const FIELDS = [
  { name: 'requester', choices: null },
  { name: 'status', choices: { 2: ['Aberto', 'Em andamento'], 3: ['Pendente', 'Aguardando'], 4: ['Resolvido', 'Resolvido'] } },
  { name: 'ticket_type', choices: ['Dúvida', 'Problema'] },
];

test('parseTicketFields extrai status (rótulo do agente) e tipos', () => {
  assert.deepEqual(parseTicketFields(FIELDS), {
    statuses: [
      { value: 2, label: 'Aberto' },
      { value: 3, label: 'Pendente' },
      { value: 4, label: 'Resolvido' },
    ],
    types: ['Dúvida', 'Problema'],
  });
});

test('parseTicketFields tolera campos ausentes', () => {
  assert.deepEqual(parseTicketFields([]), { statuses: [], types: [] });
});

test('computeChanges retorna vazio sem alterações', () => {
  const ticket = { status: 2, responder_id: null, type: null };
  assert.deepEqual(computeChanges(ticket, { status: 2, responderId: null, type: '' }), {});
});

test('computeChanges inclui só os campos alterados', () => {
  const ticket = { status: 2, responder_id: null, type: null };
  assert.deepEqual(computeChanges(ticket, { status: 2, responderId: 77, type: 'Dúvida' }), { responder_id: 77, type: 'Dúvida' });
});

test('computeChanges envia responder_id null ao remover o agente', () => {
  const ticket = { status: 2, responder_id: 77, type: 'Dúvida' };
  assert.deepEqual(computeChanges(ticket, { status: 2, responderId: null, type: 'Dúvida' }), { responder_id: null });
});

test('validateSave permite só responder em ticket sem tipo', () => {
  assert.deepEqual(validateSave({ text: 'Olá', changes: {}, form: { type: '' } }), []);
});

test('validateSave exige tipo quando há alteração de campos', () => {
  assert.deepEqual(validateSave({ text: '', changes: { responder_id: 77 }, form: { type: '' } }), [
    { field: 'type', message: 'Escolha o Tipo antes de alterar o ticket.' },
  ]);
});

test('validateSave recusa quando não há nada para salvar', () => {
  assert.deepEqual(validateSave({ text: '   ', changes: {}, form: { type: 'Dúvida' } }), [
    { field: null, message: 'Nada para salvar.' },
  ]);
});

test('buildOptions marca o valor atual', () => {
  assert.deepEqual(buildOptions([{ value: '', label: '--' }, { value: 7, label: 'Ana' }], 7), [
    { value: '', label: '--', selected: false },
    { value: '7', label: 'Ana', selected: true },
  ]);
});

test('buildOptions mantém selecionado um valor atual fora da lista', () => {
  assert.deepEqual(buildOptions([{ value: '', label: '--' }, { value: 7, label: 'Ana' }], 99, (v) => `Agente #${v}`), [
    { value: '99', label: 'Agente #99', selected: true },
    { value: '', label: '--', selected: false },
    { value: '7', label: 'Ana', selected: false },
  ]);
});

test('buildOptions com valor nulo seleciona a opção vazia', () => {
  const options = buildOptions([{ value: '', label: '--' }, { value: 7, label: 'Ana' }], null);
  assert.deepEqual(options.map((o) => o.selected), [true, false]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/queue.test.js tests/fields.test.js`
Expected: FAIL — módulos `src/queue.js` e `src/fields.js` não encontrados

- [ ] **Step 3: Implementar**

Criar `src/queue.js`:

```js
export const OPEN_STATUS = 2;

export function buildQueueQueries(groupId, meId) {
  return {
    unassigned: `group_id:${groupId} AND agent_id:null AND status:${OPEN_STATUS}`,
    mine: `group_id:${groupId} AND agent_id:${meId} AND status:${OPEN_STATUS}`,
  };
}

export function sortQueue(tickets) {
  return tickets
    .filter((t) => t.status === OPEN_STATUS)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}
```

Criar `src/fields.js`:

```js
export function parseTicketFields(fields) {
  const status = fields.find((f) => f.name === 'status');
  const type = fields.find((f) => f.name === 'ticket_type');
  const statuses = status
    ? Object.entries(status.choices).map(([value, labels]) => ({
        value: Number(value),
        label: Array.isArray(labels) ? labels[0] : String(labels),
      }))
    : [];
  const types = type ? (Array.isArray(type.choices) ? type.choices : Object.keys(type.choices)) : [];
  return { statuses, types };
}

export function computeChanges(ticket, form) {
  const changes = {};
  if (form.status !== ticket.status) changes.status = form.status;
  if (form.responderId !== (ticket.responder_id ?? null)) changes.responder_id = form.responderId;
  if ((form.type || null) !== (ticket.type || null)) changes.type = form.type || null;
  return changes;
}

export function validateSave({ text, changes, form }) {
  const hasText = text.trim().length > 0;
  const hasChanges = Object.keys(changes).length > 0;
  if (!hasText && !hasChanges) return [{ field: null, message: 'Nada para salvar.' }];
  if (hasChanges && !form.type) return [{ field: 'type', message: 'Escolha o Tipo antes de alterar o ticket.' }];
  return [];
}

export function buildOptions(options, current, unknownLabel = (v) => String(v)) {
  const list = options.map(({ value, label }) => ({ value: String(value), label }));
  const selected = current == null ? '' : String(current);
  if (selected !== '' && !list.some((o) => o.value === selected)) {
    list.unshift({ value: selected, label: unknownLabel(current) });
  }
  return list.map((o) => ({ ...o, selected: o.value === selected }));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/queue.test.js tests/fields.test.js`
Expected: PASS (14 testes)

- [ ] **Step 5: Commit**

```bash
git add src/queue.js src/fields.js tests/queue.test.js tests/fields.test.js
git commit -m "feat: regras da fila e dos campos do ticket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cliente da API do Freshdesk

**Files:**
- Create: `src/api.js`
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: nada
- Produces (`src/api.js`):
  - `class ApiError extends Error { status: number; retryAfter: number|null }` — `status` 0 = rede
  - `createClient({ domain: string, apiKey: string, fetchFn?: typeof fetch })` retorna:
    - `me()`, `groups()`, `group(id)`, `agents()`, `ticketFields()`
    - `searchTickets(query: string): Promise<Ticket[]>` (pagina de 30 em 30, máx. 10 páginas)
    - `contact(id)`, `ticket(id)` (com `include=requester`), `conversations(id)`
    - `cannedFolders()`, `cannedResponses(folderId)`, `cannedResponse(id)`
    - `reply(id, bodyHtml)`, `note(id, bodyHtml)`, `updateTicket(id, changes)`
  - Listas (`groups`, `agents`, `conversations`) paginam com `per_page=100` até vir página incompleta

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/api.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/api.test.js`
Expected: FAIL — módulo `src/api.js` não encontrado

- [ ] **Step 3: Implementar**

Criar `src/api.js`:

```js
const PAGE_SIZE = 100;
const SEARCH_PAGE_SIZE = 30;
const SEARCH_MAX_PAGES = 10;

export class ApiError extends Error {
  constructor(message, status, retryAfter = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function createClient({ domain, apiKey, fetchFn = fetch }) {
  const base = `https://${domain}/api/v2`;
  const auth = 'Basic ' + btoa(`${apiKey}:X`);

  async function request(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetchFn(base + path, {
        method,
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Sem conexão com o Freshdesk.', 0);
    }
    if (response.status === 401) throw new ApiError('Chave de API inválida.', 401);
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After')) || 60;
      throw new ApiError(`Limite de requisições do Freshdesk atingido. Tente de novo em ${retryAfter}s.`, 429, retryAfter);
    }
    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      throw new ApiError(
        `O domínio ${domain} não respondeu como a API do Freshdesk. Tente o endereço sua-conta.freshdesk.com.`,
        response.status,
      );
    }
    const data = await response.json();
    if (!response.ok) {
      const detail = data?.errors?.map((e) => `${e.field}: ${e.message}`).join('; ') || data?.description || '';
      throw new ApiError(`Erro ${response.status} do Freshdesk. ${detail}`.trim(), response.status);
    }
    return data;
  }

  async function paged(path) {
    const all = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; ; page++) {
      const items = await request(`${path}${sep}per_page=${PAGE_SIZE}&page=${page}`);
      all.push(...items);
      if (items.length < PAGE_SIZE) return all;
    }
  }

  async function searchTickets(query) {
    const all = [];
    const encoded = encodeURIComponent(`"${query}"`);
    for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
      const { results } = await request(`/search/tickets?query=${encoded}&page=${page}`);
      all.push(...results);
      if (results.length < SEARCH_PAGE_SIZE) break;
    }
    return all;
  }

  return {
    me: () => request('/agents/me'),
    groups: () => paged('/groups'),
    group: (id) => request(`/groups/${id}`),
    agents: () => paged('/agents'),
    ticketFields: () => request('/ticket_fields'),
    searchTickets,
    contact: (id) => request(`/contacts/${id}`),
    ticket: (id) => request(`/tickets/${id}?include=requester`),
    conversations: (id) => paged(`/tickets/${id}/conversations`),
    cannedFolders: () => request('/canned_response_folders'),
    cannedResponses: (folderId) => request(`/canned_response_folders/${folderId}/responses`),
    cannedResponse: (id) => request(`/canned_responses/${id}`),
    reply: (id, bodyHtml) => request(`/tickets/${id}/reply`, { method: 'POST', body: { body: bodyHtml } }),
    note: (id, bodyHtml) => request(`/tickets/${id}/notes`, { method: 'POST', body: { body: bodyHtml, private: true } }),
    updateTicket: (id, changes) => request(`/tickets/${id}`, { method: 'PUT', body: changes }),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/api.test.js`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add src/api.js tests/api.test.js
git commit -m "feat: cliente da API v2 do Freshdesk

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Storage (configuração, cache e nomes)

**Files:**
- Create: `src/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: uma área no formato de `chrome.storage.local` (`get(keys|null)`, `set(items)`, `remove(keys)`, todas retornando Promise)
- Produces (`src/storage.js`):
  - `DAY_MS: number`
  - `createStorage(area)` retorna:
    - `loadConfig(): Promise<Config|null>` / `saveConfig(config): Promise<void>` — `Config = { domain, apiKey, meId, groupId }`
    - `cached(key: string, loader: () => Promise<T>, opts?: { ttlMs?: number, now?: number }): Promise<T>`
    - `clearCache(): Promise<void>` — remove só chaves `cache:*`
    - `loadNames(): Promise<Record<string,string>>` / `saveNames(names): Promise<void>`

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/storage.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, DAY_MS } from '../src/storage.js';

function fakeArea() {
  const data = {};
  return {
    data,
    async get(keys) {
      if (keys === null) return structuredClone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k];
    },
  };
}

test('config começa vazia e é salva', async () => {
  const storage = createStorage(fakeArea());
  assert.equal(await storage.loadConfig(), null);
  await storage.saveConfig({ domain: 'd', apiKey: 'k', meId: 9, groupId: 5 });
  assert.deepEqual(await storage.loadConfig(), { domain: 'd', apiKey: 'k', meId: 9, groupId: 5 });
});

test('cached chama o loader uma vez dentro do TTL de 24 h', async () => {
  const storage = createStorage(fakeArea());
  let calls = 0;
  const loader = async () => ++calls;
  assert.equal(await storage.cached('ref', loader, { now: 1000 }), 1);
  assert.equal(await storage.cached('ref', loader, { now: 1000 + DAY_MS - 1 }), 1);
  assert.equal(await storage.cached('ref', loader, { now: 1000 + DAY_MS }), 2);
});

test('clearCache remove o cache e preserva config e nomes', async () => {
  const area = fakeArea();
  const storage = createStorage(area);
  await storage.saveConfig({ domain: 'd' });
  await storage.saveNames({ 50: 'Maria' });
  await storage.cached('ref', async () => 'x');
  await storage.clearCache();
  assert.deepEqual(Object.keys(area.data).sort(), ['config', 'names']);
});

test('nomes começam vazios e são salvos', async () => {
  const storage = createStorage(fakeArea());
  assert.deepEqual(await storage.loadNames(), {});
  await storage.saveNames({ 50: 'Maria' });
  assert.deepEqual(await storage.loadNames(), { 50: 'Maria' });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/storage.test.js`
Expected: FAIL — módulo `src/storage.js` não encontrado

- [ ] **Step 3: Implementar**

Criar `src/storage.js`:

```js
const CONFIG_KEY = 'config';
const NAMES_KEY = 'names';
const CACHE_PREFIX = 'cache:';

export const DAY_MS = 24 * 60 * 60 * 1000;

export function createStorage(area) {
  async function read(key) {
    const items = await area.get(key);
    return items[key];
  }

  return {
    async loadConfig() {
      return (await read(CONFIG_KEY)) ?? null;
    },
    saveConfig: (config) => area.set({ [CONFIG_KEY]: config }),

    async cached(key, loader, { ttlMs = DAY_MS, now = Date.now() } = {}) {
      const fullKey = CACHE_PREFIX + key;
      const entry = await read(fullKey);
      if (entry && now - entry.savedAt < ttlMs) return entry.value;
      const value = await loader();
      await area.set({ [fullKey]: { value, savedAt: now } });
      return value;
    },
    async clearCache() {
      const keys = Object.keys(await area.get(null)).filter((k) => k.startsWith(CACHE_PREFIX));
      if (keys.length) await area.remove(keys);
    },

    async loadNames() {
      return (await read(NAMES_KEY)) ?? {};
    },
    saveNames: (names) => area.set({ [NAMES_KEY]: names }),
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/storage.test.js`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add src/storage.js tests/storage.test.js
git commit -m "feat: storage de configuração, cache e nomes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fluxos (configurar, fila, ticket, salvar)

**Files:**
- Create: `src/actions.js`
- Test: `tests/actions.test.js`

**Interfaces:**
- Consumes: cliente de `createClient` (Task 3; nos testes, um objeto falso com os mesmos métodos); `buildQueueQueries`, `sortQueue` (Task 2); `parseTicketFields` (Task 2); `textToHtml` (Task 1)
- Produces (`src/actions.js`):
  - `GROUP_NAME = 'CSM - Engajamento'`
  - `discoverSetup(client, groupName?): Promise<{ meId: number, groupId: number }>` — erro `Grupo "<nome>" não encontrado no Freshdesk.`
  - `loadReference(client, groupId): Promise<{ agents: {id,name}[], statuses, types, canned: {id,title,folder}[] }>` — agentes só do grupo, ordenados por nome
  - `loadQueue(client, { groupId, meId }, knownNames?): Promise<{ unassigned: Ticket[], mine: Ticket[], names: Record<string,string> }>` — busca nomes faltantes com `client.contact`, ignora falhas
  - `loadTicket(client, ticketId, agents?): Promise<{ ticket, messages: { id, from, text, private, incoming, createdAt }[] }>` — descrição + conversas em ordem cronológica
  - `saveTicket(client, { ticketId, mode: 'reply'|'note', text, changes }): Promise<{ sent: boolean, updated: boolean, error?: Error }>` — envia texto (se houver) e depois PUT (se houver); se o PUT falhar após envio, retorna `error` em vez de lançar

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/actions.test.js`:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test tests/actions.test.js`
Expected: FAIL — módulo `src/actions.js` não encontrado

- [ ] **Step 3: Implementar**

Criar `src/actions.js`:

```js
import { buildQueueQueries, sortQueue } from './queue.js';
import { parseTicketFields } from './fields.js';
import { textToHtml } from './format.js';

export const GROUP_NAME = 'CSM - Engajamento';

export async function discoverSetup(client, groupName = GROUP_NAME) {
  const [me, groups] = await Promise.all([client.me(), client.groups()]);
  const wanted = groupName.trim().toLowerCase();
  const group = groups.find((g) => g.name.trim().toLowerCase() === wanted);
  if (!group) throw new Error(`Grupo "${groupName}" não encontrado no Freshdesk.`);
  return { meId: me.id, groupId: group.id };
}

export async function loadReference(client, groupId) {
  const [group, agents, fields, folders] = await Promise.all([
    client.group(groupId),
    client.agents(),
    client.ticketFields(),
    client.cannedFolders(),
  ]);
  const inGroup = new Set(group.agent_ids ?? []);
  const groupAgents = agents
    .filter((a) => inGroup.has(a.id))
    .map((a) => ({ id: a.id, name: a.contact?.name || a.contact?.email || `Agente #${a.id}` }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const responses = await Promise.all(folders.map((f) => client.cannedResponses(f.id)));
  const canned = folders.flatMap((f, i) => responses[i].map((r) => ({ id: r.id, title: r.title, folder: f.name })));
  return { agents: groupAgents, ...parseTicketFields(fields), canned };
}

export async function loadQueue(client, { groupId, meId }, knownNames = {}) {
  const queries = buildQueueQueries(groupId, meId);
  const [unassigned, mine] = await Promise.all([
    client.searchTickets(queries.unassigned),
    client.searchTickets(queries.mine),
  ]);
  const names = { ...knownNames };
  const missing = [...new Set([...unassigned, ...mine].map((t) => t.requester_id))]
    .filter((id) => id != null && !(id in names));
  await Promise.all(missing.map(async (id) => {
    try {
      const contact = await client.contact(id);
      names[id] = contact.name || contact.email;
    } catch {
      // sem nome: a tela mostra "Cliente #id" e tenta de novo na próxima carga
    }
  }));
  return { unassigned: sortQueue(unassigned), mine: sortQueue(mine), names };
}

export async function loadTicket(client, ticketId, agents = []) {
  const [ticket, conversations] = await Promise.all([client.ticket(ticketId), client.conversations(ticketId)]);
  const agentNames = new Map(agents.map((a) => [a.id, a.name]));
  const requester = ticket.requester?.name || ticket.requester?.email || 'Cliente';
  const authorOf = (c) => {
    if (c.user_id === ticket.requester_id) return requester;
    if (c.incoming) return c.from_email || 'Cliente';
    return agentNames.get(c.user_id) || 'Agente';
  };
  const messages = [
    {
      id: `ticket-${ticket.id}`,
      from: requester,
      text: ticket.description_text ?? '',
      private: false,
      incoming: true,
      createdAt: ticket.created_at,
    },
    ...conversations.map((c) => ({
      id: c.id,
      from: authorOf(c),
      text: c.body_text ?? '',
      private: Boolean(c.private),
      incoming: Boolean(c.incoming),
      createdAt: c.created_at,
    })),
  ].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return { ticket, messages };
}

export async function saveTicket(client, { ticketId, mode, text, changes }) {
  const result = { sent: false, updated: false };
  if (text.trim()) {
    const body = textToHtml(text);
    if (mode === 'note') await client.note(ticketId, body);
    else await client.reply(ticketId, body);
    result.sent = true;
  }
  if (Object.keys(changes).length > 0) {
    try {
      await client.updateTicket(ticketId, changes);
      result.updated = true;
    } catch (error) {
      if (!result.sent) throw error;
      result.error = error;
    }
  }
  return result;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test tests/actions.test.js`
Expected: PASS (13 testes)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS (49 testes, 0 falhas)

- [ ] **Step 6: Commit**

```bash
git add src/actions.js tests/actions.test.js
git commit -m "feat: fluxos de configuração, fila, ticket e salvar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Popup da extensão (manifest, HTML, CSS, telas)

**Files:**
- Create: `manifest.json`, `popup.html`, `popup.css`, `src/popup.js`

**Interfaces:**
- Consumes: `createClient`, `ApiError` (Task 3); `createStorage` (Task 4); `discoverSetup`, `loadReference`, `loadQueue`, `loadTicket`, `saveTicket` (Task 5); `computeChanges`, `validateSave`, `buildOptions` (Task 2); `timeAgo`, `normalizeDomain`, `fillPlaceholders` (Task 1)
- Produces: a extensão carregável

Este arquivo usa `document`, `DOMParser` e `chrome.storage`, então não tem teste automatizado. A lógica que ele chama já está testada. A verificação é sintática aqui e manual na Task 7.

- [ ] **Step 1: Criar `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "NextDesk",
  "version": "0.1.0",
  "description": "Responda e delegue tickets do Freshdesk sem abrir a ferramenta.",
  "action": {
    "default_popup": "popup.html",
    "default_title": "NextDesk"
  },
  "permissions": ["storage"],
  "host_permissions": [
    "https://ajuda.nextfit.com.br/*",
    "https://*.freshdesk.com/*"
  ]
}
```

- [ ] **Step 2: Criar `popup.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>NextDesk</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <header class="bar">
    <button id="back" class="icon" type="button" title="Voltar" hidden>←</button>
    <h1 id="title">NextDesk</h1>
    <button id="refresh" class="icon" type="button" title="Atualizar" hidden>⟳</button>
    <button id="settings" class="icon" type="button" title="Configurações" hidden>⚙</button>
  </header>
  <div id="message" class="message" role="status" hidden></div>
  <main id="view"></main>
  <script type="module" src="src/popup.js"></script>
</body>
</html>
```

- [ ] **Step 3: Criar `popup.css`**

```css
:root {
  --bg: #ffffff;
  --fg: #1f2328;
  --muted: #656d76;
  --line: #d0d7de;
  --accent: #0b6bcb;
  --soft: #f6f8fa;
  --note: #fff8c5;
  --error: #cf222e;
  --ok: #1a7f37;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161b22;
    --fg: #e6edf3;
    --muted: #8d96a0;
    --line: #30363d;
    --accent: #4493f8;
    --soft: #1f242c;
    --note: #3b2e00;
    --error: #ff7b72;
    --ok: #3fb950;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  width: 420px;
  max-height: 600px;
  display: flex;
  flex-direction: column;
  font: 13px/1.4 system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
}

.bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}

.bar h1 { flex: 1; margin: 0; font-size: 14px; }

.icon {
  border: 0;
  background: none;
  color: inherit;
  font-size: 16px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
}

.icon:hover { background: var(--soft); }

.message {
  margin: 8px 10px 0;
  padding: 6px 8px;
  border: 1px solid currentColor;
  border-radius: 4px;
}

.message.error { color: var(--error); }
.message.info { color: var(--ok); }

main { padding: 10px; overflow-y: auto; }

h2 {
  margin: 8px 0 4px;
  font-size: 12px;
  text-transform: uppercase;
  color: var(--muted);
}

ul { list-style: none; margin: 0; padding: 0; }

.ticket-row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 4px;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}

.ticket-row:hover { background: var(--soft); }

.subject { font-weight: 600; }

.meta, .empty, .hint, .loading { color: var(--muted); font-size: 12px; }

.ticket-head { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
.ticket-head a { color: var(--accent); font-size: 12px; }

.thread {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  margin: 0 0 10px;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.msg { padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; }
.msg.incoming { background: var(--soft); }
.msg.private { background: var(--note); }
.msg-head { margin-bottom: 2px; font-size: 11px; color: var(--muted); }
.msg-body { white-space: pre-wrap; word-break: break-word; }

form { display: flex; flex-direction: column; gap: 8px; }

label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--muted); }

input, select, textarea, button {
  font: inherit;
  color: inherit;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 5px 6px;
}

button { cursor: pointer; }
textarea { resize: vertical; }
textarea.note { background: var(--note); }

.row { display: flex; gap: 6px; }
.row > * { flex: 1; min-width: 0; }

.invalid { border-color: var(--error); outline: 1px solid var(--error); }

.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.primary:disabled { opacity: 0.6; cursor: default; }
```

- [ ] **Step 4: Criar `src/popup.js`**

```js
import { createClient, ApiError } from './api.js';
import { createStorage } from './storage.js';
import { discoverSetup, loadReference, loadQueue, loadTicket, saveTicket } from './actions.js';
import { computeChanges, validateSave, buildOptions } from './fields.js';
import { timeAgo, normalizeDomain, fillPlaceholders } from './format.js';

const DEFAULT_DOMAIN = 'ajuda.nextfit.com.br';
const REPLY_PLACEHOLDER = 'Escreva a resposta para o cliente…';
const NOTE_PLACEHOLDER = 'Nota visível só para o time…';

const storage = createStorage(chrome.storage.local);
const view = document.getElementById('view');
const state = { config: null, client: null, ref: null };

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

function showMessage(text, kind = 'error') {
  const box = document.getElementById('message');
  box.textContent = text;
  box.className = `message ${kind}`;
  box.hidden = !text;
}

function setHeader(title, { back = null, refresh = null, settings = false } = {}) {
  document.getElementById('title').textContent = title;
  const bind = (id, handler) => {
    const button = document.getElementById(id);
    button.hidden = !handler;
    button.onclick = handler;
  };
  bind('back', back);
  bind('refresh', refresh);
  bind('settings', settings ? () => showSetup() : null);
}

function showLoading() {
  view.replaceChildren(h('p', { class: 'loading' }, 'Carregando…'));
}

async function run(task) {
  try {
    await task();
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) showSetup(error.message);
    else showMessage(error.message);
    return false;
  }
}

function connect(config) {
  state.config = config;
  state.client = createClient(config);
}

async function getRef() {
  state.ref ??= await storage.cached(`ref:${state.config.groupId}`, () => loadReference(state.client, state.config.groupId));
  return state.ref;
}

function showSetup(error = '') {
  setHeader('Configuração', { back: state.config ? () => showQueue() : null });
  showMessage(error);
  const domain = h('input', { value: state.config?.domain ?? DEFAULT_DOMAIN, required: true });
  const apiKey = h('input', { type: 'password', value: state.config?.apiKey ?? '', required: true, autocomplete: 'off' });
  const save = h('button', { type: 'submit', class: 'primary' }, 'Salvar');

  async function onSubmit(event) {
    event.preventDefault();
    save.disabled = true;
    showMessage('Validando…', 'info');
    const draft = { domain: normalizeDomain(domain.value), apiKey: apiKey.value.trim() };
    try {
      const setup = await discoverSetup(createClient(draft));
      const config = { ...draft, ...setup };
      await storage.saveConfig(config);
      await storage.clearCache();
      state.ref = null;
      connect(config);
      await showQueue('Configuração salva.');
    } catch (err) {
      showMessage(err.message);
      save.disabled = false;
    }
  }

  async function reloadData() {
    await storage.clearCache();
    state.ref = null;
    showMessage('Agentes, tipos e respostas prontas serão recarregados.', 'info');
  }

  view.replaceChildren(h('form', { onsubmit: onSubmit },
    h('label', {}, 'Domínio do Freshdesk', domain),
    h('label', {}, 'Chave de API', apiKey),
    h('p', { class: 'hint' }, 'No Freshdesk: clique na sua foto → Configurações do perfil → Visualizar chave de API.'),
    save,
    state.config ? h('button', { type: 'button', onclick: reloadData }, 'Recarregar agentes, tipos e respostas prontas') : null,
  ));
}

async function showQueue(notice = '') {
  setHeader('Tickets abertos', { refresh: () => showQueue(), settings: true });
  showMessage(notice, 'info');
  showLoading();
  const ok = await run(async () => {
    const queue = await loadQueue(state.client, state.config, await storage.loadNames());
    await storage.saveNames(queue.names);
    view.replaceChildren(
      queueSection('Sem responsável', queue.unassigned, queue.names),
      queueSection('Meus tickets', queue.mine, queue.names),
    );
  });
  if (!ok) view.querySelector('.loading')?.remove();
}

function queueSection(title, tickets, names) {
  return h('section', {},
    h('h2', {}, `${title} (${tickets.length})`),
    tickets.length
      ? h('ul', {}, tickets.map((t) => h('li', {},
          h('button', { type: 'button', class: 'ticket-row', onclick: () => showTicket(t.id) },
            h('span', { class: 'subject' }, t.subject || '(sem assunto)'),
            h('span', { class: 'meta' }, `${names[t.requester_id] || `Cliente #${t.requester_id}`} · #${t.id} · ${timeAgo(t.created_at)}`)))))
      : h('p', { class: 'empty' }, 'Nenhum ticket.'));
}

async function showTicket(ticketId) {
  setHeader(`Ticket #${ticketId}`, { back: () => showQueue() });
  showMessage('');
  showLoading();
  const ok = await run(async () => {
    const ref = await getRef();
    const { ticket, messages } = await loadTicket(state.client, ticketId, ref.agents);
    view.replaceChildren(ticketView(ticket, messages, ref));
    const thread = view.querySelector('.thread');
    thread.scrollTop = thread.scrollHeight;
  });
  if (!ok) view.querySelector('.loading')?.remove();
}

function selectOf(options, current, unknownLabel) {
  return h('select', {}, buildOptions(options, current, unknownLabel)
    .map((o) => h('option', { value: o.value, selected: o.selected }, o.label)));
}

function messageItem(m) {
  const kind = m.private ? 'private' : m.incoming ? 'incoming' : 'outgoing';
  const head = [m.from, m.private ? 'nota privada' : null, timeAgo(m.createdAt)].filter(Boolean).join(' · ');
  return h('li', { class: `msg ${kind}` },
    h('div', { class: 'msg-head' }, head),
    h('div', { class: 'msg-body' }, m.text.trim() || '(sem texto)'));
}

function htmlToText(html) {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return doc.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

async function insertCanned(select, textarea, ticket) {
  const id = select.value;
  select.value = '';
  if (!id) return;
  await run(async () => {
    const response = await state.client.cannedResponse(id);
    const content = fillPlaceholders(htmlToText(response.content_html || response.content || ''), ticket);
    textarea.value = textarea.value.trim() ? `${textarea.value.trimEnd()}\n\n${content}` : content;
    textarea.focus();
    if (/\{\{.+?\}\}/.test(content)) {
      showMessage('A resposta pronta tem campos {{...}} que não foram preenchidos. Revise antes de enviar.', 'info');
    }
  });
}

function ticketView(ticket, messages, ref) {
  const requester = ticket.requester?.name || ticket.requester?.email || 'Cliente';
  const text = h('textarea', { rows: 5, placeholder: REPLY_PLACEHOLDER });
  const mode = h('select', {
    onchange: () => {
      const isNote = mode.value === 'note';
      text.placeholder = isNote ? NOTE_PLACEHOLDER : REPLY_PLACEHOLDER;
      text.classList.toggle('note', isNote);
    },
  },
    h('option', { value: 'reply' }, 'Responder ao cliente'),
    h('option', { value: 'note' }, 'Nota privada'));
  const canned = h('select', { onchange: () => insertCanned(canned, text, ticket) },
    h('option', { value: '' }, 'Inserir resposta pronta…'),
    ref.canned.map((c) => h('option', { value: String(c.id) }, `${c.folder} / ${c.title}`)));
  const status = selectOf(ref.statuses, ticket.status, (v) => `Status ${v}`);
  const agent = selectOf(
    [{ value: '', label: '-- sem agente --' }, ...ref.agents.map((a) => ({ value: a.id, label: a.name }))],
    ticket.responder_id,
    (v) => `Agente #${v}`,
  );
  const type = selectOf([{ value: '', label: '--' }, ...ref.types.map((t) => ({ value: t, label: t }))], ticket.type, (v) => v);
  const save = h('button', { type: 'submit', class: 'primary' }, 'Salvar');

  async function onSubmit(event) {
    event.preventDefault();
    const form = { status: Number(status.value), responderId: agent.value ? Number(agent.value) : null, type: type.value };
    const changes = computeChanges(ticket, form);
    const errors = validateSave({ text: text.value, changes, form });
    type.classList.toggle('invalid', errors.some((e) => e.field === 'type'));
    if (errors.length) {
      showMessage(errors.map((e) => e.message).join(' '));
      return;
    }
    const isNote = mode.value === 'note';
    save.disabled = true;
    showMessage('');
    await run(async () => {
      const result = await saveTicket(state.client, { ticketId: ticket.id, mode: mode.value, text: text.value, changes });
      if (result.error) {
        text.value = '';
        showMessage(`${isNote ? 'Nota salva' : 'Resposta enviada'}, mas os campos não foram salvos: ${result.error.message}`);
        return;
      }
      const notice = result.sent ? (isNote ? 'Nota salva.' : 'Resposta enviada.') : 'Ticket atualizado.';
      await showQueue(notice);
    });
    save.disabled = false;
  }

  return h('div', {},
    h('div', { class: 'ticket-head' },
      h('span', { class: 'subject' }, ticket.subject || '(sem assunto)'),
      h('span', { class: 'meta' }, `${requester} · aberto ${timeAgo(ticket.created_at)}`),
      h('a', { href: `https://${state.config.domain}/a/tickets/${ticket.id}`, target: '_blank', rel: 'noopener' }, 'Abrir no Freshdesk')),
    h('ol', { class: 'thread' }, messages.map(messageItem)),
    h('form', { onsubmit: onSubmit },
      h('div', { class: 'row' }, mode, canned),
      text,
      h('div', { class: 'row' },
        h('label', {}, 'Status', status),
        h('label', {}, 'Agente', agent),
        h('label', {}, 'Tipo', type)),
      save));
}

async function start() {
  const config = await storage.loadConfig();
  if (!config) {
    showSetup();
    return;
  }
  connect(config);
  await showQueue();
}

start();
```

- [ ] **Step 5: Checar a sintaxe e a suíte**

Run: `node --check src/popup.js; npm test`
Expected: `node --check` sem saída (sintaxe válida); `npm test` PASS (49 testes)

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`
Expected: `manifest ok`

- [ ] **Step 6: Commit**

```bash
git add manifest.json popup.html popup.css src/popup.js
git commit -m "feat: popup da extensão com fila, ticket e configuração

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: README e verificação manual com o Freshdesk real

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: a extensão da Task 6
- Produces: instruções de instalação e o resultado do teste manual

- [ ] **Step 1: Criar `README.md`**

````markdown
# NextDesk

Extensão do Chrome/Edge para tratar os tickets abertos do grupo **CSM - Engajamento** do Freshdesk sem abrir a ferramenta: ver a fila, responder, deixar nota privada e alterar Status, Agente e Tipo.

## Instalar

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta.
4. Fixe o ícone do NextDesk na barra.

## Configurar

1. No Freshdesk, clique na sua foto → **Configurações do perfil** → **Visualizar chave de API**.
2. Abra o popup do NextDesk, confira o domínio (`ajuda.nextfit.com.br`) e cole a chave.
3. Se aparecer que o domínio não respondeu como API, use o endereço `sua-conta.freshdesk.com`.

A chave fica só no armazenamento local do navegador.

## Atualizar depois de mudar o código

Em `chrome://extensions`, clique no ícone de recarregar do NextDesk.

## Testes

```bash
npm test
```

Requer Node 18 ou mais novo. Não há dependências.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: instruções de instalação e uso

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Verificação manual (feita pelo usuário, com a chave dele)**

Pedir ao usuário que siga o README e confira, relatando o resultado de cada item. Para ver erros: botão direito no popup → **Inspecionar** → aba Console.

1. Primeira abertura mostra a tela **Configuração**; salvar com uma chave errada mostra "Chave de API inválida."
2. Com a chave certa, aparece "Configuração salva." e a lista com os dois blocos; as contagens batem com o filtro `69000401702` do Freshdesk (lembrando que a extensão mostra só status Aberto)
3. Cada item mostra assunto, nome do cliente, número e tempo
4. Abrir um ticket mostra a conversa em ordem, com notas privadas em amarelo, e o link "Abrir no Freshdesk" funciona
5. Status, Agente e Tipo vêm com os valores atuais do ticket; a lista de agentes tem só o time do CSM
6. Escolher uma resposta pronta preenche o texto (sem enviar)
7. **Só num ticket de teste indicado pelo usuário:** enviar nota privada; enviar resposta; trocar o agente; confirmar no Freshdesk que tudo chegou
8. Num ticket sem Tipo, mudar o agente mostra "Escolha o Tipo antes de alterar o ticket." e destaca o campo

Anotar qualquer divergência como bug e tratá-la com superpowers:systematic-debugging antes de declarar pronto.
