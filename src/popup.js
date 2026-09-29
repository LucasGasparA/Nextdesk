import { createClient, ApiError } from './api.js';
import { createStorage } from './storage.js';
import { discoverSetup, loadReference, loadQueue, loadTicket, saveTicket } from './actions.js';
import { computeChanges, validateSave, buildOptions } from './fields.js';
import { timeAgo, normalizeDomain, fillPlaceholders, linksToText, DEFAULT_DOMAIN } from './format.js';
import { createNavigator } from './nav.js';

const REPLY_PLACEHOLDER = 'Escreva a resposta para o cliente…';
const NOTE_PLACEHOLDER = 'Nota visível só para o time…';

const storage = createStorage(chrome.storage.local);
const view = document.getElementById('view');
const state = { config: null, client: null, ref: null };
const nav = createNavigator();

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
  nav.begin();
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
  const isCurrent = nav.begin();
  setHeader('Tickets abertos', { refresh: () => showQueue(), settings: true });
  showMessage(notice, 'info');
  showLoading();
  const ok = await run(async () => {
    const queue = await loadQueue(state.client, state.config, await storage.loadNames());
    await storage.saveNames(queue.names);
    if (!isCurrent()) return;
    view.replaceChildren(
      queueSection('Sem responsável', queue.unassigned, queue.names),
      queueSection('Meus tickets', queue.mine, queue.names),
    );
  });
  if (!ok && isCurrent()) view.querySelector('.loading')?.remove();
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
  const isCurrent = nav.begin();
  setHeader(`Ticket #${ticketId}`, { back: () => showQueue() });
  showMessage('');
  showLoading();
  const ok = await run(async () => {
    const ref = await getRef();
    const { ticket, messages } = await loadTicket(state.client, ticketId, ref.agents);
    if (!isCurrent()) return;
    view.replaceChildren(ticketView(ticket, messages, ref));
    const thread = view.querySelector('.thread');
    thread.scrollTop = thread.scrollHeight;
  });
  if (!ok && isCurrent()) view.querySelector('.loading')?.remove();
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
  const withBreaks = linksToText(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
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
