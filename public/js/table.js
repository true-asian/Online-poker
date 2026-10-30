import { fmt, esc, cardHtml, initials, colorFor, setHtml, toast, openModal, amountModal, request } from './ui.js';
import { seatPoint, towardCentre, dealerPoint } from './layout.js';

const STREET_LINE = /^\*\*\*/;

function chipTier(amount, bb) {
  if (amount >= bb * 50) return 't4';
  if (amount >= bb * 15) return 't3';
  if (amount >= bb * 4) return 't2';
  return '';
}

export class TableView {
  constructor({ root, socket, tableId, getUser, onExit }) {
    Object.assign(this, { root, socket, tableId, getUser, onExit });
    this.state = null;
    this.mounted = false;
    this.preAction = null; // 'checkfold' | 'check' | 'callany'
    this.preActionKey = null;
    this.actionsKey = null;
    this.feedTab = 'log';
    this.feedKey = null;
    this.sending = false;

    this.onState = (state) => this.render(state);
    socket.on('table:state', this.onState);
    this.watch();
    this.onKey = (e) => this.handleKey(e);
    document.addEventListener('keydown', this.onKey);
    root.innerHTML = '<p class="act-note" style="padding:40px">Joining table…</p>';
  }

  watch() {
    request(this.socket, 'table:watch', { tableId: this.tableId }).then((res) => {
      if (!res.ok) this.onExit();
    });
  }

  onReconnect() {
    this.watch();
  }

  destroy() {
    this.socket.off('table:state', this.onState);
    this.socket.emit('table:unwatch');
    document.removeEventListener('keydown', this.onKey);
  }

  emit(event, payload = {}) {
    return request(this.socket, event, { tableId: this.tableId, ...payload });
  }

  // ── skeleton ───────────────────────────────────────────────────────

  mount(state) {
    this.root.innerHTML = `
      <section class="table-view">
        <div class="tv-top">
          <button class="btn ghost small" data-exit>← Lobby</button>
          <div class="tv-title">
            <span class="tv-name">${esc(state.name)}</span>
            <span class="tv-meta">No-Limit Hold'em · ${fmt(state.smallBlind)}/${fmt(state.bigBlind)} · ${state.maxSeats}-max · Buy-in ${fmt(state.minBuyIn)}–${fmt(state.maxBuyIn)}</span>
          </div>
          <div class="tv-controls"></div>
        </div>
        <div class="tv-stage">
          <div class="table-wrap">
            <div class="table-shadow"></div>
            <div class="table-rail"><div class="table-felt">
              <div class="felt-logo"><b>ALL IN</b><span>NO-LIMIT HOLD'EM</span></div>
            </div></div>
            <div class="pot-area"><div class="pot-total"></div><div class="pot-side"></div></div>
            <div class="board">${'<div class="slot"></div>'.repeat(5)}</div>
            <div class="status-banner"></div>
            <div class="seats"></div>
            <div class="bets"></div>
            <div class="dealer-btn" hidden>D</div>
          </div>
        </div>
        <div class="tv-bottom">
          <div class="panel feed">
            <div class="tabs">
              <button data-tab="log" class="active">Hand log</button>
              <button data-tab="chat">Chat</button>
            </div>
            <div class="feed-list"></div>
            <form data-chat hidden><input class="input" maxlength="200" placeholder="Say something nice…"><button class="btn small">Send</button></form>
          </div>
          <div></div>
          <div class="panel actions"></div>
        </div>
      </section>`;

    const $ = (sel) => this.root.querySelector(sel);
    this.el = {
      controls: $('.tv-controls'),
      potTotal: $('.pot-total'),
      potSide: $('.pot-side'),
      slots: [...this.root.querySelectorAll('.board .slot')],
      banner: $('.status-banner'),
      seats: $('.seats'),
      bets: $('.bets'),
      dealer: $('.dealer-btn'),
      feed: $('.feed-list'),
      chatForm: $('[data-chat]'),
      actions: $('.actions'),
    };

    this.seatEls = [];
    this.betEls = [];
    for (let i = 0; i < state.maxSeats; i++) {
      const seat = document.createElement('div');
      seat.className = 'seat';
      seat.innerHTML = '<div class="seat-cards"></div><div class="seat-plate"></div><div class="seat-timer"></div><div class="seat-tag"></div>';
      this.el.seats.append(seat);
      this.seatEls.push({
        root: seat,
        cards: seat.querySelector('.seat-cards'),
        plate: seat.querySelector('.seat-plate'),
        timer: seat.querySelector('.seat-timer'),
        tag: seat.querySelector('.seat-tag'),
      });
      const bet = document.createElement('div');
      bet.className = 'bet';
      this.el.bets.append(bet);
      this.betEls.push(bet);
    }

    this.root.addEventListener('click', (e) => this.handleClick(e));
    this.root.querySelectorAll('[data-tab]').forEach((tab) => {
      tab.onclick = () => {
        this.feedTab = tab.dataset.tab;
        this.root.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('active', t === tab));
        this.el.chatForm.hidden = this.feedTab !== 'chat';
        this.feedKey = null;
        this.renderFeed(this.state);
      };
    });
    this.el.chatForm.onsubmit = (e) => {
      e.preventDefault();
      const input = this.el.chatForm.querySelector('input');
      if (!input.value.trim()) return;
      this.emit('table:chat', { text: input.value });
      input.value = '';
    };
    this.mounted = true;
  }

  // ── rendering ──────────────────────────────────────────────────────

  render(state) {
    if (state.id !== this.tableId) return;
    if (!this.mounted) this.mount(state);
    const prev = this.state;
    this.state = state;
    const hand = state.hand;

    // Clear pre-actions when a new street or hand starts.
    const streetKey = hand ? `${hand.number}:${hand.street}` : '';
    if (prev && streetKey !== this.preActionKey) this.preAction = null;
    this.preActionKey = streetKey;

    // Rotate so you're always at the bottom centre.
    const offset = state.you ? state.you.seat : 0;
    const wrap = this.root.querySelector('.table-wrap');
    this.aspect = wrap.clientWidth / wrap.clientHeight || 1.85;
    this.compact = wrap.clientWidth < 600;
    const display = (seat) => (seat - offset + state.maxSeats) % state.maxSeats;
    const results = hand?.results;
    const winners = new Map((results?.winners ?? []).map((w) => [w.seat, w.amount]));
    const mainBest = results?.showdown ? results.shown[results.pots[0].winners[0].seat]?.best ?? [] : [];

    state.seats.forEach((s, i) => this.renderSeat(s, i, state, display(i), winners, results));

    // Board
    const board = hand?.board ?? [];
    this.el.slots.forEach((slot, i) => {
      setHtml(slot, board[i] ? cardHtml(board[i], 'deal') : '');
      const card = slot.firstElementChild;
      if (card) {
        card.classList.toggle('hi', mainBest.includes(board[i]));
        card.classList.toggle('dim', !!results?.showdown && !mainBest.includes(board[i]));
      }
    });

    // Pot
    if (hand && hand.totalPot > 0) {
      setHtml(this.el.potTotal, `<i class="chip ${chipTier(hand.totalPot, state.bigBlind)}"></i>Pot ${fmt(hand.totalPot)}`);
      setHtml(this.el.potSide, hand.pots.length > 1
        ? hand.pots.map((p, i) => `${i ? `Side ${i}` : 'Main'} ${fmt(p)}`).join(' · ')
        : '');
    } else {
      setHtml(this.el.potTotal, '');
      setHtml(this.el.potSide, '');
    }

    // Dealer button
    if (hand && hand.button >= 0) {
      const [x, y] = dealerPoint(seatPoint(state.maxSeats, display(hand.button), this.compact), this.aspect);
      this.el.dealer.hidden = false;
      this.el.dealer.style.left = `${x}%`;
      this.el.dealer.style.top = `${y}%`;
    } else {
      this.el.dealer.hidden = true;
    }

    this.renderBanner(state);
    this.renderControls(state);
    this.renderActions(state);
    this.renderFeed(state);
    this.maybeAutoAct(state);
  }

  renderSeat(s, i, state, d, winners, results) {
    const els = this.seatEls[i];
    const [x, y] = seatPoint(state.maxSeats, d, this.compact);
    els.root.style.left = `${x}%`;
    els.root.style.top = `${y}%`;
    const bet = this.betEls[i];
    const [bx, by] = towardCentre([x, y], 0.42);
    bet.style.left = `${bx}%`;
    bet.style.top = `${by}%`;

    if (!s) {
      els.root.className = 'seat';
      setHtml(els.cards, '');
      setHtml(els.plate, state.you ? '<div class="seat-empty">Open seat</div>' : `<button class="seat-empty" data-sit="${i}">Sit here</button>`);
      setHtml(els.timer, '');
      setHtml(els.tag, '');
      setHtml(bet, '');
      return;
    }

    const turn = state.turn?.seat === i;
    const won = winners.get(i);
    els.root.className = [
      'seat',
      s.isYou && 'you',
      s.folded && 'folded',
      (s.sittingOut || s.waiting) && 'away',
      turn && 'turn',
      won && 'winner',
    ].filter(Boolean).join(' ');

    // Hole cards (re-rendered only when they change so the deal animation plays once).
    setHtml(els.cards, s.cards.map((c) => cardHtml(c, 'deal')).join(''));
    const best = results?.shown?.[i]?.best;
    els.cards.querySelectorAll('.card').forEach((card) => {
      card.classList.toggle('hi', !!(won && best?.includes(card.dataset.card)));
    });

    setHtml(els.plate, `
      <div class="plate">
        <div class="avatar" style="--av:${colorFor(s.name)}">${esc(initials(s.name))}${s.isBot ? '<em class="bot-tag">BOT</em>' : ''}</div>
        <div class="pinfo">
          <div class="pname"><span>${esc(s.name)}</span></div>
          <div class="pstack${s.allIn ? ' allin' : ''}">${s.allIn ? 'ALL-IN' : fmt(s.stack)}</div>
        </div>
      </div>`);

    // Countdown bar, restarted only when a new turn begins.
    if (turn) {
      const t = state.turn;
      if (els.timer.dataset.turn !== String(t.id)) {
        els.timer.dataset.turn = t.id;
        els.timer.innerHTML = `<i style="--dur:${t.remainingMs}ms;--from:${(t.remainingMs / t.totalMs).toFixed(3)}"></i>`;
        els.timer._html = null;
      }
    } else {
      els.timer.dataset.turn = '';
      setHtml(els.timer, '');
    }

    // Tag under the seat: result > last action > status.
    let tag = '';
    if (won) {
      tag = `<span class="atag win">+${fmt(won)}</span>`;
      if (results.shown[i]) tag += `<div class="hand-name">${esc(results.shown[i].handName)}</div>`;
    } else if (results?.shown?.[i]) {
      tag = `<div class="hand-name" style="color:var(--muted)">${esc(results.shown[i].handName)}</div>`;
    } else if (s.lastAction) {
      const { label, amount } = s.lastAction;
      const cls = label.toLowerCase().replace(/[^a-z]+/g, '-');
      const showAmount = amount && !['Check', 'Fold'].includes(label);
      tag = `<span class="atag ${cls}">${esc(label)}${showAmount && label !== 'All-in' ? ` ${fmt(amount)}` : ''}</span>`;
    } else if (s.leaving) tag = '<span class="atag status">Leaving</span>';
    else if (s.sittingOut) tag = '<span class="atag status">Sitting out</span>';
    else if (s.waiting) tag = '<span class="atag status">Waiting for big blind</span>';
    setHtml(els.tag, tag);

    setHtml(bet, s.bet > 0 ? `<i class="chip ${chipTier(s.bet, state.bigBlind)}"></i>${fmt(s.bet)}` : '');
  }

  renderBanner(state) {
    const results = state.hand?.results;
    let html = '';
    let win = false;
    if (results) {
      const name = (seat) => state.seats[seat]?.name ?? `Seat ${seat + 1}`;
      const pot = results.pots[0];
      const who = pot.winners.map((w) => esc(name(w.seat))).join(' & ');
      html = pot.winners.length > 1
        ? `Split pot — ${who}${pot.handName ? ` with ${esc(pot.handName)}` : ''}`
        : `${who} wins ${fmt(pot.amount)}${pot.handName ? ` with ${esc(pot.handName)}` : ''}`;
      if (results.pots.length > 1) html += ` · +${results.pots.length - 1} side pot${results.pots.length > 2 ? 's' : ''}`;
      win = true;
    } else if (state.status) {
      html = esc(state.status);
    }
    this.el.banner.classList.toggle('win', win);
    setHtml(this.el.banner, html);
  }

  renderControls(state) {
    const you = state.you;
    if (!you) return setHtml(this.el.controls, '');
    setHtml(this.el.controls, `
      <button class="btn small" data-topup>Add chips</button>
      ${you.sittingOut
        ? '<button class="btn small green" data-back>I\'m back</button>'
        : `<label class="toggle" style="padding:6px 12px"><input type="checkbox" data-sitout ${you.sitOutNext ? 'checked' : ''}> Sit out next hand</label>`}
      <button class="btn small red" data-leave>Leave seat</button>`);
  }

  renderActions(state) {
    const you = state.you;
    const hand = state.hand;
    const me = you ? state.seats[you.seat] : null;
    const legal = you?.legal;
    let key;
    let html;

    if (!you) {
      key = 'watching';
      html = '<p class="act-note">You\'re watching. <strong>Pick an open seat</strong> to buy in and play.</p>';
    } else if (legal) {
      key = `turn:${state.turn?.id}`;
      html = this.actionControls(state, legal);
    } else if (you.sittingOut) {
      key = `away:${me.stack + you.pendingChips > 0}`;
      html = me.stack + you.pendingChips > 0
        ? '<p class="act-note">You\'re <strong>sitting out</strong>. Hit “I\'m back” when you\'re ready.</p>'
        : '<p class="act-note">You\'re out of chips. <strong>Add chips</strong> to keep playing, or leave the seat.</p>';
    } else if (you.waiting) {
      key = `waiting:${you.postNow}`;
      html = `
        <p class="act-note"><strong>Waiting for the big blind</strong> to reach you before you're dealt in.</p>
        <label class="toggle"><input type="checkbox" data-postnow ${you.postNow ? 'checked' : ''}> Post a big blind and play next hand</label>`;
    } else if (me?.inHand && !me.folded && !me.allIn && hand && !hand.results) {
      const owe = state.seats.some((s) => s && s.bet > me.bet);
      if (owe && this.preAction === 'check') this.preAction = null;
      key = `pre:${this.preAction}:${owe}`;
      const opt = (value, label) => `<label class="toggle"><input type="checkbox" data-pre="${value}" ${this.preAction === value ? 'checked' : ''}> ${label}</label>`;
      html = `<div class="pre-row">${opt('checkfold', 'Check / Fold')}${owe ? '' : opt('check', 'Check')}${opt('callany', 'Call any')}</div>`;
    } else {
      key = 'idle';
      html = `<p class="act-note">${hand?.results ? 'Next hand starting…' : me?.folded ? 'You folded. Next hand soon.' : 'Waiting for the next hand…'}</p>`;
    }

    if (key !== this.actionsKey) {
      this.actionsKey = key;
      this.el.actions.innerHTML = html;
      if (legal) this.bindRaise(state, legal);
    }
  }

  actionControls(state, legal) {
    const callLabel = legal.canCheck
      ? 'Check'
      : `${legal.callAmount >= legal.stack ? 'All-in' : 'Call'}<small>${fmt(legal.callAmount)}</small>`;
    const raiseControls = legal.canRaise ? `
      <div class="presets">
        <button class="btn" data-preset="min">Min</button>
        <button class="btn" data-preset="0.5">½ Pot</button>
        <button class="btn" data-preset="0.75">¾ Pot</button>
        <button class="btn" data-preset="1">Pot</button>
        <button class="btn" data-preset="max">All-in</button>
      </div>
      <div class="raise-row">
        <input type="range" min="${legal.minRaiseTo}" max="${legal.maxRaiseTo}" step="${state.smallBlind}" value="${legal.minRaiseTo}" data-raise-range aria-label="Raise amount">
        <input class="input" inputmode="numeric" value="${legal.minRaiseTo}" data-raise-input aria-label="Raise to">
      </div>` : '';
    return `
      ${raiseControls}
      <div class="act-row">
        ${legal.canCheck ? '' : '<button class="btn red" data-act="fold">Fold<small>F</small></button>'}
        <button class="btn blue" data-act="${legal.canCheck ? 'check' : 'call'}">${callLabel}</button>
        ${legal.canRaise ? `<button class="btn gold" data-act="raise">${legal.isBet ? 'Bet' : 'Raise to'}<small data-raise-label>${fmt(legal.minRaiseTo)}</small></button>` : ''}
      </div>`;
  }

  bindRaise(state, legal) {
    if (!legal.canRaise) return;
    const range = this.el.actions.querySelector('[data-raise-range]');
    const input = this.el.actions.querySelector('[data-raise-input]');
    const label = this.el.actions.querySelector('[data-raise-label]');
    const clamp = (v) => Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(v)));
    this.raiseTo = legal.minRaiseTo;
    const set = (v, from) => {
      this.raiseTo = clamp(v);
      if (from !== range) range.value = this.raiseTo;
      if (from !== input) input.value = this.raiseTo;
      label.textContent = this.raiseTo >= legal.maxRaiseTo ? 'All-in' : fmt(this.raiseTo);
    };
    range.oninput = () => set(Number(range.value), range);
    input.oninput = () => {
      const v = Number(input.value.replace(/[^\d]/g, ''));
      if (v) {
        this.raiseTo = clamp(v);
        label.textContent = this.raiseTo >= legal.maxRaiseTo ? 'All-in' : fmt(this.raiseTo);
        range.value = this.raiseTo;
      }
    };
    input.onblur = () => set(this.raiseTo, null);
    this.el.actions.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.onclick = () => {
        const p = btn.dataset.preset;
        const pot = state.hand.totalPot;
        if (p === 'min') return set(legal.minRaiseTo);
        if (p === 'max') return set(legal.maxRaiseTo);
        // Pot-sized raise = call, then raise by the pot after calling.
        const to = legal.currentBet + Number(p) * (pot + legal.callAmount);
        set(Math.round(to / state.smallBlind) * state.smallBlind);
      };
    });
  }

  renderFeed(state) {
    const items = this.feedTab === 'log' ? state.log : state.chat;
    const last = this.feedTab === 'log' ? state.log.at(-1) : state.chat.at(-1)?.id;
    const key = `${this.feedTab}:${items.length}:${last}`;
    if (key === this.feedKey) return;
    this.feedKey = key;
    const list = this.el.feed;
    const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 30;
    list.innerHTML = this.feedTab === 'log'
      ? state.log.map((line) => `<p class="${STREET_LINE.test(line) ? 'street' : ''}">${esc(line)}</p>`).join('')
      : state.chat.length
        ? state.chat.map((m) => `<p><span class="who">${esc(m.from)}:</span> ${esc(m.text)}</p>`).join('')
        : '<p style="color:var(--muted)">No messages yet.</p>';
    if (stick || !this.feedScrolled) list.scrollTop = list.scrollHeight;
    this.feedScrolled = true;
  }

  // ── input ──────────────────────────────────────────────────────────

  async act(type, amount) {
    if (this.sending) return;
    this.sending = true;
    await this.emit('table:action', { type, amount });
    this.sending = false;
  }

  maybeAutoAct(state) {
    const legal = state.you?.legal;
    if (!legal || !this.preAction) return;
    const pre = this.preAction;
    this.preAction = null;
    if (pre === 'checkfold') this.act(legal.canCheck ? 'check' : 'fold');
    else if (pre === 'callany') this.act(legal.canCheck ? 'check' : 'call');
    else if (pre === 'check' && legal.canCheck) this.act('check');
  }

  handleClick(e) {
    const t = e.target.closest('button, input');
    if (!t) return;
    const state = this.state;
    const legal = state?.you?.legal;

    if (t.matches('[data-exit]')) return this.exit();
    if (t.matches('[data-sit]')) return this.sitDialog(Number(t.dataset.sit));
    if (t.matches('[data-leave]')) return this.emit('table:leave');
    if (t.matches('[data-topup]')) return this.topUpDialog();
    if (t.matches('[data-back]')) return this.emit('table:sitout', { value: false });
    if (t.matches('[data-sitout]')) return this.emit('table:sitout', { value: t.checked });
    if (t.matches('[data-postnow]')) return this.emit('table:postnow', { value: t.checked });
    if (t.matches('[data-pre]')) {
      this.preAction = t.checked ? t.dataset.pre : null;
      this.actionsKey = null;
      return this.renderActions(state);
    }
    if (t.matches('[data-act]') && legal) {
      const type = t.dataset.act;
      if (type === 'raise') return this.act('raise', this.raiseTo);
      return this.act(type);
    }
  }

  handleKey(e) {
    if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const legal = this.state?.you?.legal;
    if (!legal) return;
    const k = e.key.toLowerCase();
    if (k === 'f' && !legal.canCheck) this.act('fold');
    else if (k === 'c' || k === 'k') this.act(legal.canCheck ? 'check' : 'call');
    else if (k === 'r' && legal.canRaise) this.act('raise', this.raiseTo);
  }

  exit() {
    if (!this.state?.you) return this.onExit();
    openModal({
      title: 'Leave the table?',
      body: '<p>Your seat is given up and your chips go back to your bankroll. If you\'re in a hand, it\'s folded.</p>',
      confirmText: 'Leave table',
      confirmClass: 'red',
      onConfirm: async () => {
        await this.emit('table:leave');
        this.onExit();
      },
    });
  }

  sitDialog(seat) {
    const s = this.state;
    const bankroll = this.getUser().bankroll;
    if (bankroll < s.minBuyIn) {
      toast(`You need at least ${fmt(s.minBuyIn)} chips to sit here${this.getUser().canReload ? ' — use Reload up top' : ''}.`);
      return;
    }
    const max = Math.min(s.maxBuyIn, bankroll);
    // Default to the max buy-in, but never more than half the bankroll in one go.
    const half = Math.floor(bankroll / 2 / s.bigBlind) * s.bigBlind;
    const value = Math.min(max, Math.max(s.minBuyIn, half));
    amountModal({
      title: `Buy in · Seat ${seat + 1}`,
      text: `Bankroll ${fmt(bankroll)}. Buy-in ${fmt(s.minBuyIn)}–${fmt(s.maxBuyIn)} (${s.minBuyIn / s.bigBlind}–${s.maxBuyIn / s.bigBlind} big blinds).`,
      min: s.minBuyIn,
      max,
      value,
      step: s.bigBlind,
      confirmText: 'Take seat',
      onConfirm: async (amount) => (await this.emit('table:sit', { seat, buyIn: amount })).ok,
    });
  }

  topUpDialog() {
    const s = this.state;
    const me = s.seats[s.you.seat];
    const onTable = me.stack + s.you.pendingChips;
    const bankroll = this.getUser().bankroll;
    const room = s.maxBuyIn - onTable;
    const min = onTable === 0 ? s.minBuyIn : s.bigBlind;
    const max = Math.min(room, bankroll);
    if (room <= 0) return toast(`You already have the table maximum (${fmt(s.maxBuyIn)}).`, 'info');
    if (max < min) return toast('Not enough chips in your bankroll.');
    amountModal({
      title: 'Add chips',
      text: `You have ${fmt(onTable)} on the table (max ${fmt(s.maxBuyIn)}). Chips added during a hand arrive before the next one.`,
      min,
      max,
      value: max,
      step: s.bigBlind > max - min ? 1 : s.bigBlind,
      confirmText: 'Add chips',
      onConfirm: async (amount) => (await this.emit('table:topup', { amount })).ok,
    });
  }
}
