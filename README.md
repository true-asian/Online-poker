# All In Poker Room

A play-money No-Limit Texas Hold'em site with real-time multiplayer cash tables. Bots keep every table running and give up their seats as people sit down. Everyone starts with **10,000 chips**. No real money.

## Features

- **Accounts:** username + password, with your bankroll saved on the server. When your total (bankroll + chips on tables) drops under 1,000 you can reload back to 10,000.
- **Lobby:** six cash tables, a mix of 9-max and 6-max, with blinds from 10/20 up to 250/500. Buy-ins are 40–100 big blinds.
- **Live tables:** real-time over WebSockets. You always sit at the bottom of the screen. There's a 25-second action timer, pre-action boxes (check/fold, check, call any), bet presets (min, ½ pot, ¾ pot, pot, all-in), a hand log and table chat.
- **Bots:** each bot gets its own personality. They play preflop from hand-strength charts and postflop from Monte Carlo equity, and they're labelled `BOT`.

## Rules implemented

The engine follows standard online cash-game rules:

- Blinds, button and action order, including heads-up (the button posts the small blind, acts first preflop and last after the flop).
- Minimum bet is the big blind. A raise must be at least the size of the last full bet or raise.
- A short all-in raise doesn't re-open the betting to players who already acted. Several short all-ins that add up to a full raise do.
- A big blind that's all-in for less still plays as a full big blind.
- Uncalled bets go back to the bettor. Main and side pots are built from each player's contribution.
- Split pots give the odd chip to the first winner left of the button.
- At showdown the last aggressor shows first, or the first player left of the button if there was no bet. Losing hands are mucked. If anyone is all-in, every hand is turned face up.
- Burn cards before the flop, turn and river. The deck is shuffled with a cryptographic RNG.
- Moving button. New players wait for the big blind or post one to play straight away (not from the seats between the button and the small blind). Players who sat out while the big blind passed them have to wait for it again.
- If you time out facing a bet, your hand is folded and you're sat out. After 5 minutes sitting out you're stood up and your chips go back to your bankroll.

Not included: rake, straddles, run-it-twice, time banks, or showing cards when you win without a showdown.

## Run it locally

You need Node.js 22.13 or newer. The database uses the built-in `node:sqlite`, so there are no native modules to build.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. To try multiplayer on one machine, use two browsers (or one normal window plus one private window) logged in as different accounts.

```bash
npm test
```

The tests cover hand rankings, betting rules, side pots, button and blind placement, a 10,000-hand random stress test that checks no chips are created or lost, and table-level runs with simulated time.

| Env var    | Default  | Meaning                         |
| ---------- | -------- | ------------------------------- |
| `PORT`     | `3000`   | HTTP port                       |
| `DATA_DIR` | `./data` | Where the SQLite database lives |

## Deploy

This app needs a host that runs a Node server with WebSockets, so GitHub Pages won't work. Render's free tier does work, and `render.yaml` is included: create a new **Blueprint** on Render and point it at this repo.

On a free host the disk is wiped on every redeploy and restart, which resets all accounts. To keep them, attach a persistent disk and set `DATA_DIR` to its mount path.

If the server restarts mid-hand, every player's chips on tables go back to their bankroll as they were at the start of that hand.

## Project layout

```
server/
  index.js        HTTP + Socket.IO bootstrap
  auth.js         register / login / sessions / reload API
  db.js           SQLite storage and chip accounting
  room.js         tables <-> sockets wiring
  table.js        a cash table: seats, game loop, timers, bots, per-player views
  config.js       starting chips, timers, table list
  poker/
    hand.js       one hand of NLHE as a pure state machine
    positions.js  button / blind / who's dealt in
    pots.js       main + side pot splitting
    evaluator.js  7-card hand evaluator
    cards.js      cards, deck, secure shuffle
    bot.js        bot decision making
public/           the browser client (plain ES modules, no build step)
test/             node:test suites
```
