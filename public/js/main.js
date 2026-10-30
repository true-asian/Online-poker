import { fmt, toast, request } from './ui.js';
import { renderLobby } from './lobby.js';
import { TableView } from './table.js';

const view = document.getElementById('view');
const topbar = document.querySelector('.topbar');
const TOKEN_KEY = 'poker.token'; // per tab: a refresh keeps your seat, a new tab is a new player

const app = {
  user: null,
  socket: null,
  lobby: [],
  current: null, // active view with a destroy() method
};

// ── account header ───────────────────────────────────────────────────

function setUser(user) {
  const first = !app.user && user;
  app.user = user;
  topbar.hidden = !user;
  if (!user) return;
  topbar.querySelector('[data-bankroll]').textContent = fmt(user.bankroll);
  topbar.querySelector('[data-inplay]').textContent = fmt(user.inPlay);
  topbar.querySelector('[data-inplay-wrap]').hidden = !user.inPlay;
  topbar.querySelector('[data-username]').textContent = user.username;
  topbar.querySelector('[data-reload]').hidden = !user.canReload;
  if (first) route();
  else app.current?.onUser?.(user);
}

function quit(message) {
  app.socket?.disconnect();
  app.socket = null;
  sessionStorage.removeItem(TOKEN_KEY);
  setUser(null);
  history.replaceState(null, '', location.pathname);
  showJoin(message);
}

topbar.querySelector('[data-logout]').onclick = async () => {
  await request(app.socket, 'player:quit');
  quit();
};

topbar.querySelector('[data-reload]').onclick = async () => {
  const res = await request(app.socket, 'player:reload');
  if (res.ok) toast('Bankroll reloaded to 10,000 chips', 'info');
};

// ── join screen ──────────────────────────────────────────────────────

function showJoin(message = '') {
  app.current?.destroy?.();
  app.current = null;
  view.innerHTML = `
    <section class="auth">
      <div class="auth-card panel">
        <div class="auth-logo">♠</div>
        <h1>ALL IN</h1>
        <p class="tagline">No-Limit Texas Hold'em · Play money only</p>
        <form novalidate>
          <label>Pick a name for the table
            <input class="input" name="name" autocomplete="nickname" maxlength="16" required placeholder="e.g. RiverRat">
          </label>
          <p class="error" aria-live="polite"></p>
          <button class="btn gold" type="submit">Take me to the tables</button>
        </form>
        <p class="fineprint">Everyone starts with <strong>10,000 chips</strong>. Nothing is saved: close the tab and you start fresh.</p>
      </div>
    </section>`;
  const form = view.querySelector('form');
  const submit = form.querySelector('button');
  const error = form.querySelector('.error');
  error.textContent = message;
  form.onsubmit = async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: form.name.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not join. Try again.');
      sessionStorage.setItem(TOKEN_KEY, data.token);
      if (!location.hash) location.hash = '#/lobby';
      connect(data.token);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  };
  form.name.focus();
}

// ── realtime + routing ───────────────────────────────────────────────

function connect(token) {
  const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  app.socket = socket;
  socket.on('me', setUser);
  socket.on('lobby', (tables) => {
    app.lobby = tables;
    app.current?.onLobby?.(tables);
  });
  socket.on('connect', () => {
    socket.emit('lobby:join');
    app.current?.onReconnect?.();
  });
  socket.on('connect_error', (err) => {
    // The server restarted (or we quit) so this token is gone: start over.
    if (err.message === 'unauthorized') quit(app.user ? 'The room restarted. Pick a name to jump back in.' : '');
  });
}

function route() {
  if (!app.user || !app.socket) return;
  app.current?.destroy?.();
  app.current = null;
  const match = location.hash.match(/^#\/table\/([\w-]+)/);
  if (match) {
    app.current = new TableView({
      root: view,
      socket: app.socket,
      tableId: match[1],
      getUser: () => app.user,
      onExit: () => { location.hash = '#/lobby'; },
    });
  } else {
    app.current = renderLobby({ root: view, getUser: () => app.user, getTables: () => app.lobby });
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

const saved = sessionStorage.getItem(TOKEN_KEY);
if (saved) {
  view.innerHTML = '<p class="act-note" style="padding:40px">Reconnecting…</p>';
  connect(saved);
} else {
  showJoin();
}
