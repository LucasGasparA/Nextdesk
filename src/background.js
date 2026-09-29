import { createClient } from './api.js';
import { createStorage } from './storage.js';
import { countUnassigned } from './actions.js';
import { showBadge } from './badge.js';

const ALARM = 'refresh-badge';
const PERIOD_MINUTES = 30;
const storage = createStorage(chrome.storage.local);

async function refreshBadge() {
  const config = await storage.loadConfig();
  if (!config) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  try {
    await showBadge(await countUnassigned(createClient(config), config));
  } catch {
    // mantém o último número; o popup mostra o erro quando for aberto
  }
}

function start() {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MINUTES });
  refreshBadge();
}

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) refreshBadge();
});
