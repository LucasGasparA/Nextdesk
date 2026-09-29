export const DEFAULT_DOMAIN = 'sistemanextfit.freshdesk.com';

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

export function linksToText(html) {
  return html.replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (match, quote, href, inner) => {
    const label = inner.replace(/<[^>]*>/g, '').trim();
    return !label || label === href ? href : `${label} (${href})`;
  });
}

const HOUR_MS = 60 * 60 * 1000;

export function ageLevel(iso, now = Date.now()) {
  const age = now - Date.parse(iso);
  if (age < 4 * HOUR_MS) return 'fresh';
  if (age < 24 * HOUR_MS) return 'warn';
  return 'late';
}

export function badgeText(count) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}
