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
    if (response.redirected) {
      const host = new URL(response.url).host;
      if (host !== domain) {
        throw new ApiError(`O domínio ${domain} redireciona para ${host}. Use ${host} na configuração.`, 0);
      }
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
