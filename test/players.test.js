import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerStore, PlayerError } from '../server/players.js';

test('new players start with 10,000 and need a unique, sensible name', () => {
  const store = new PlayerStore();
  const p = store.create('  River   Rat ');
  assert.equal(p.username, 'River Rat');
  assert.equal(p.bankroll, 10_000);
  assert.equal(store.fromToken(p.token), p);
  assert.throws(() => store.create('river rat'), PlayerError);
  assert.throws(() => store.create('x'), PlayerError);
  assert.throws(() => store.create('<script>'), PlayerError);
  assert.equal(store.fromToken('nope'), null);
});

test('buy-in, results and cash-out move chips between bankroll and table', () => {
  const store = new PlayerStore();
  const { id } = store.create('alice');
  assert.equal(store.buyIn(id, 12_000), false);
  assert.equal(store.buyIn(id, 4000), true);
  store.adjustInPlay(id, -1500); // lost a pot
  store.cashOut(id, 2500);
  assert.deepEqual([store.user(id).bankroll, store.user(id).inPlay], [8500, 0]);
});

test('reload only once nearly broke, back to 10,000 including chips on tables', () => {
  const store = new PlayerStore();
  const { id } = store.create('bob');
  assert.equal(store.reload(id), false);
  store.buyIn(id, 9500);
  store.adjustInPlay(id, -9100); // 400 left on the table, 500 in bankroll
  assert.equal(store.reload(id), true);
  assert.equal(store.user(id).bankroll + store.user(id).inPlay, 10_000);
});

test('removed players free their name and token', () => {
  const store = new PlayerStore();
  const p = store.create('carol');
  store.remove(p.id);
  assert.equal(store.fromToken(p.token), null);
  assert.doesNotThrow(() => store.create('carol'));
  // Chip calls for a player who already left are ignored rather than crashing a table.
  assert.doesNotThrow(() => store.cashOut(p.id, 100));
});
