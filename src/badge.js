import { badgeText } from './format.js';

export const BADGE_COLOR = '#d93025';

export async function showBadge(count) {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  await chrome.action.setBadgeText({ text: badgeText(count) });
}
