const CONFIG_KEY = 'config';
const NAMES_KEY = 'names';
const CACHE_PREFIX = 'cache:';

export const DAY_MS = 24 * 60 * 60 * 1000;

export function createStorage(area) {
  async function read(key) {
    const items = await area.get(key);
    return items[key];
  }

  return {
    async loadConfig() {
      return (await read(CONFIG_KEY)) ?? null;
    },
    saveConfig: (config) => area.set({ [CONFIG_KEY]: config }),

    async cached(key, loader, { ttlMs = DAY_MS, now = Date.now() } = {}) {
      const fullKey = CACHE_PREFIX + key;
      const entry = await read(fullKey);
      if (entry && now - entry.savedAt < ttlMs) return entry.value;
      const value = await loader();
      await area.set({ [fullKey]: { value, savedAt: now } });
      return value;
    },
    async clearCache() {
      const keys = Object.keys(await area.get(null)).filter((k) => k.startsWith(CACHE_PREFIX));
      if (keys.length) await area.remove(keys);
    },

    async loadNames() {
      return (await read(NAMES_KEY)) ?? {};
    },
    saveNames: (names) => area.set({ [NAMES_KEY]: names }),
  };
}
