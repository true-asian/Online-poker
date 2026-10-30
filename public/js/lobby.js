import { fmt, esc, setHtml } from './ui.js';
import { SEAT_LAYOUTS } from './layout.js';

function miniTable(t) {
  const dots = SEAT_LAYOUTS[t.maxSeats].map(([x, y], i) => {
    const cls = i < t.players ? (i < t.humans.length ? 'human' : 'on') : '';
    return `<i class="${cls}" style="left:${x}%;top:${y}%"></i>`;
  });
  return `<div class="mini-table">${dots.join('')}</div>`;
}

function row(t, user) {
  const seated = t.humans.includes(user.username);
  const affordable = user.bankroll >= t.minBuyIn || seated;
  const people = t.humans.length
    ? `${t.humans.length} ${t.humans.length === 1 ? 'person' : 'people'}: ${t.humans.map(esc).join(', ')}`
    : 'Bots only — be the first';
  return `
    <article class="table-row panel${seated ? ' seated' : ''}">
      ${miniTable(t)}
      <div>
        <div class="t-name">${esc(t.name)}</div>
        <div class="t-sub">
          <span class="badge gold">${t.maxSeats}-max</span>
          <span class="badge">NL Hold'em</span>
          ${seated ? '<span class="badge green">Seated</span>' : ''}
        </div>
      </div>
      <div class="cell-stakes">
        <div class="cell-label">Blinds</div>
        <div class="cell-value">${fmt(t.smallBlind)}/${fmt(t.bigBlind)}</div>
      </div>
      <div class="cell-buyin">
        <div class="cell-label">Buy-in</div>
        <div class="cell-value">${fmt(t.minBuyIn)} – ${fmt(t.maxBuyIn)}</div>
      </div>
      <div class="cell-players">
        <div class="cell-label">Players</div>
        <div class="cell-value">${t.players}/${t.maxSeats}</div>
        <div class="cell-note" title="${esc(people)}">${people}</div>
      </div>
      <a class="btn ${seated ? 'green' : affordable ? 'gold' : ''}" href="#/table/${esc(t.id)}">${seated ? 'Return' : affordable ? 'Open' : 'Watch'}</a>
    </article>`;
}

export function renderLobby({ root, getUser, getTables }) {
  root.innerHTML = `
    <section class="lobby">
      <div class="lobby-hero">
        <div class="eyebrow">Cash games · No-Limit Texas Hold'em</div>
        <h1>Choose your table</h1>
        <p>Pick a stake, take a seat, play. Bots keep every table going and give up their chairs as people sit down.
          Buy-ins run from 40 to 100 big blinds, and whatever you leave with goes back to your bankroll.</p>
      </div>
      <div class="table-list"></div>
      <p class="lobby-foot">Play money only. Bust out? When your total drops under 1,000 chips you can reload back to 10,000.</p>
    </section>`;
  const list = root.querySelector('.table-list');
  const draw = () => {
    const tables = getTables();
    setHtml(list, tables.length ? tables.map((t) => row(t, getUser())).join('') : '<p class="act-note">Loading tables…</p>');
  };
  draw();
  return { onLobby: draw, onUser: draw, destroy() {} };
}
