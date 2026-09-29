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
