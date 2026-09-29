import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigator } from '../src/nav.js';

test('só a navegação mais recente continua atual', () => {
  const nav = createNavigator();
  const ticket = nav.begin();
  assert.equal(ticket(), true);
  const queue = nav.begin();
  assert.equal(ticket(), false);
  assert.equal(queue(), true);
});
