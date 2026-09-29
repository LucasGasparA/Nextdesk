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
