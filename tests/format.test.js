import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, textToHtml, timeAgo, normalizeDomain, fillPlaceholders, linksToText, DEFAULT_DOMAIN, ageLevel, badgeText } from '../src/format.js';

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

test('linksToText mantém o endereço dos links como texto', () => {
  assert.equal(
    linksToText('<p>Veja <a target="_blank" href="https://x.com/a?b=1&amp;c=2">clique <b>aqui</b></a>.</p>'),
    '<p>Veja clique aqui (https://x.com/a?b=1&amp;c=2).</p>',
  );
});

test('linksToText não repete o endereço quando o texto já é o link', () => {
  assert.equal(linksToText("<a href='https://x.com'>https://x.com</a>"), 'https://x.com');
});

test('DEFAULT_DOMAIN é o endereço da API da conta, não o portal', () => {
  assert.equal(DEFAULT_DOMAIN, 'sistemanextfit.freshdesk.com');
});

test('ageLevel: até 4 h recente, até 24 h atenção, depois atrasado', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  assert.equal(ageLevel('2026-09-29T08:01:00Z', now), 'fresh');
  assert.equal(ageLevel('2026-09-29T08:00:00Z', now), 'warn');
  assert.equal(ageLevel('2026-09-28T12:00:01Z', now), 'warn');
  assert.equal(ageLevel('2026-09-28T12:00:00Z', now), 'late');
});

test('badgeText some no zero e limita em 99+', () => {
  assert.equal(badgeText(0), '');
  assert.equal(badgeText(7), '7');
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '99+');
});
