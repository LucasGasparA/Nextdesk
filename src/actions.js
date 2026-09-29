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
