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
