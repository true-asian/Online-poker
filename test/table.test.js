import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Table } from '../server/table.js';

/** In-memory stand-in for the SQLite store with the same chip accounting. */
function fakeStore(users) {
  const db = new Map(users.map((u) => [u.id, { bankroll: u.bankroll ?? 10_000, inPlay: 0 }]));
  return {
    db,
    buyIn(id, amount) {
      const u = db.get(id);
      if (u.bankroll < amount) return false;
      u.bankroll -= amount;
      u.inPlay += amount;
      return true;
    },
    cashOut(id, amount, inPlayAmount = amount) {
      const u = db.get(id);
      u.bankroll += amount;
      u.inPlay = Math.max(0, u.inPlay - inPlayAmount);
    },
    adjustInPlay(id, delta) {
      db.get(id).inPlay += delta;
    },
  };
}

function setup({ maxSeats = 6, users = [] } = {}) {
  const store = fakeStore(users);
  const table = new Table(
    { id: 't', name: 'Test', maxSeats, smallBlind: 25, bigBlind: 50 },
    { store, onUpdate: () => {}, onChips: () => {}, hasAudience: () => true },
  );
  return { table, store };
}

test.beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 }));
test.afterEach(() => mock.timers.reset());

function run(table, ms, onTick = () => {}) {
  for (let t = 0; t < ms; t += 250) {
    mock.timers.tick(250);
    onTick();
  }
}

test('bots fill the table, leaving two seats open', () => {
  const { table } = setup({ maxSeats: 9 });
  assert.equal(table.seats.filter(Boolean).length, 7);
  const { table: six } = setup({ maxSeats: 6 });
  assert.equal(six.seats.filter(Boolean).length, 4);
});

test('a human who keeps calling plays an hour of hands; chips stay accounted for', () => {
  const user = { id: 1, username: 'human', bankroll: 10_000_000 };
  const { table, store } = setup({ users: [user] });
  const errorSpy = mock.method(console, 'error', () => {});
  const seat = table.seats.findIndex((s) => !s);
  table.sit(user, seat, 5000);
  table.setPostNow(1, true);
  assert.equal(store.db.get(1).bankroll, 10_000_000 - 5000);

  run(table, 60 * 60_000, () => {
    const h = table.hand;
    const me = table.seats[seat];
    if (me && me.stack === 0 && !table.inLiveHand(seat)) table.topUp(1, 5000 - me.pendingChips);
    if (h?.phase === 'betting' && h.toAct === seat) {
      const legal = h.legalActions(seat);
      table.act(1, legal.canCheck ? 'check' : 'call');
    }
    table.viewFor(1); // views must always build
  });

  assert.equal(errorSpy.mock.callCount(), 0, 'table loop threw');
  assert.ok(table.handCount > 100, `only ${table.handCount} hands dealt`);
  // A bot left to make room for the human.
  assert.equal(table.seats.filter(Boolean).length, 4);

  table.stand(1);
  run(table, 30_000);
  const u = store.db.get(1);
  assert.equal(u.inPlay, 0, 'in-play chips cleared on leaving');
  assert.ok(u.bankroll >= 0);
  assert.equal(table.seatOf(1), -1);
});

test('a human who never acts times out, sits out, and is stood up with their chips', () => {
  const user = { id: 7, username: 'afk' };
  const { table, store } = setup({ users: [user] });
  const seat = table.seats.findIndex((s) => !s);
  table.sit(user, seat, 4000);
  table.setPostNow(7, true);

  run(table, 20 * 60_000);

  assert.equal(table.seatOf(7), -1, 'should have been removed after sitting out too long');
  const u = store.db.get(7);
  assert.equal(u.inPlay, 0);
  // At most a couple of blinds changed hands before they timed out; the rest came back.
  assert.ok(Math.abs(u.bankroll - 10_000) <= 500, `bankroll ${u.bankroll}`);
});

test('watching-only tables pause when nobody is around', () => {
  let audience = true;
  const store = fakeStore([]);
  const table = new Table(
    { id: 'p', name: 'Paused', maxSeats: 6, smallBlind: 25, bigBlind: 50 },
    { store, onUpdate: () => {}, onChips: () => {}, hasAudience: () => audience },
  );
  table.wake();
  run(table, 5 * 60_000);
  assert.ok(table.handCount > 3);
  audience = false;
  run(table, 120_000);
  const afterLeave = table.handCount;
  run(table, 120_000);
  assert.equal(table.handCount, afterLeave, 'kept dealing with nobody watching');
  assert.match(table.status, /Paused/);
});

test('hole cards are hidden from other viewers until shown', () => {
  const a = { id: 1, username: 'a' };
  const b = { id: 2, username: 'b' };
  const { table } = setup({ users: [a, b] });
  const seats = table.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
  table.sit(a, seats[0], 5000);
  table.sit(b, seats[1], 5000);
  table.setPostNow(1, true);
  table.setPostNow(2, true);
  let checked = 0;
  run(table, 5 * 60_000, () => {
    const h = table.hand;
    if (!h || h.phase === 'complete' || h.cardsExposed) return;
    if (!table.inLiveHand(seats[0]) || !table.inLiveHand(seats[1])) return;
    const viewA = table.viewFor(1);
    const bCards = viewA.seats[seats[1]].cards;
    assert.ok(bCards.every((c) => c === 'xx'), `a can see b's cards: ${bCards}`);
    assert.ok(viewA.seats[seats[0]].cards.every((c) => c !== 'xx'));
    assert.equal(viewA.you.legal === null || h.toAct === seats[0], true);
    checked++;
  });
  assert.ok(checked > 0);
});
