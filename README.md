# All In Poker Room

A play-money No-Limit Texas Hold'em site with real-time multiplayer cash tables. Pick a nickname, get **10,000 chips**, and play friends and bots. There are no accounts and nothing is saved, so every visit starts fresh. No real money.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/asiandude-me/Online-poker)

## Put it online

1. Click **Deploy to Render** above and sign in with GitHub.
2. Render reads `render.yaml` and sets up a free web service. Click **Apply** and wait for the build (about 2 minutes).
3. You get a link like `https://all-in-poker.onrender.com`. Send it to friends; anyone with the link can play from anywhere.

Every push to the repo's default branch redeploys automatically.

**The free plan sleeps** after 15 minutes with nobody connected. The next visitor waits about a minute while it wakes. Nothing is saved, so a sleep or a redeploy starts everyone over with 10,000. Anyone still on the page is sent back to the name screen.

## Features

- **No sign-up:** type a nickname and you're in with 10,000 chips. Names have to be unique among people currently online. Refreshing keeps your seat, and a new tab counts as a new player. When your total drops under 1,000 you can reload back to 10,000.
- **Lobby:** six cash tables, a mix of 9-max and 6-max, with blinds from 10/20 up to 250/500. Buy-ins are 40–100 big blinds.
- **Live tables:** real-time over WebSockets. You always sit at the bottom of the screen. There's a 25-second action timer, pre-action boxes (check/fold, check, call any), bet presets (min, ½ pot, ¾ pot, pot, all-in), a hand log and table chat.
- **Bots:** they keep every table going and give up their seats as people sit down. Each bot has its own style, and they're labelled `BOT`.
- **Fair dealing:** the server shuffles and deals with a cryptographic RNG, and your browser only ever receives your own hole cards.

## Rules implemented

The engine follows standard online cash-game rules:

- Blinds, button and action order, including heads-up (the button posts the small blind, acts first preflop and last after the flop).
- Minimum bet is the big blind. A raise must be at least the size of the last full bet or raise.
- A short all-in raise doesn't re-open the betting to players who already acted. Several short all-ins that add up to a full raise do.
- A big blind that's all-in for less still plays as a full big blind.
- Uncalled bets go back to the bettor. Main and side pots are built from each player's contribution.
- Split pots give the odd chip to the first winner left of the button.
- At showdown the last aggressor shows first, or the first player left of the button if there was no bet. Losing hands are mucked. If anyone is all-in, every hand is turned face up.
- Burn cards before the flop, turn and river.
- Moving button. New players wait for the big blind or post one to play straight away (not from the seats between the button and the small blind). Players who sat out while the big blind passed them have to wait for it again.
- If you time out facing a bet, your hand is folded and you're sat out. After 5 minutes sitting out you're stood up.

Not included: rake, straddles, run-it-twice, time banks, or showing cards when you win without a showdown.

## Run it on your own computer

You need Node.js 20.11 or newer.

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:3000. Use two tabs to play against yourself.

```bash
npm test
```

## Project layout

```
server/
  index.js        HTTP + Socket.IO bootstrap, /api/join
  players.js      in-memory players and chip accounting
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
