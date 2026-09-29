import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, DAY_MS } from '../src/storage.js';

function fakeArea() {
  const data = {};
  return {
    data,
    async get(keys) {
      if (keys === null) return structuredClone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k];
    },
  };
}

test('config começa vazia e é salva', async () => {
  const storage = createStorage(fakeArea());
  assert.equal(await storage.loadConfig(), null);
  await storage.saveConfig({ domain: 'd', apiKey: 'k', meId: 9, groupId: 5 });
  assert.deepEqual(await storage.loadConfig(), { domain: 'd', apiKey: 'k', meId: 9, groupId: 5 });
});

test('cached chama o loader uma vez dentro do TTL de 24 h', async () => {
  const storage = createStorage(fakeArea());
  let calls = 0;
  const loader = async () => ++calls;
  assert.equal(await storage.cached('ref', loader, { now: 1000 }), 1);
  assert.equal(await storage.cached('ref', loader, { now: 1000 + DAY_MS - 1 }), 1);
  assert.equal(await storage.cached('ref', loader, { now: 1000 + DAY_MS }), 2);
});

test('clearCache remove o cache e preserva config e nomes', async () => {
  const area = fakeArea();
  const storage = createStorage(area);
  await storage.saveConfig({ domain: 'd' });
  await storage.saveNames({ 50: 'Maria' });
  await storage.cached('ref', async () => 'x');
  await storage.clearCache();
  assert.deepEqual(Object.keys(area.data).sort(), ['config', 'names']);
});

test('nomes começam vazios e são salvos', async () => {
  const storage = createStorage(fakeArea());
  assert.deepEqual(await storage.loadNames(), {});
  await storage.saveNames({ 50: 'Maria' });
  assert.deepEqual(await storage.loadNames(), { 50: 'Maria' });
});
