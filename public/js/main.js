import { fmt, toast } from './ui.js';
import { renderLobby } from './lobby.js';
import { TableView } from './table.js';

const view = document.getElementById('view');
const topbar = document.querySelector('.topbar');

const app = {
  user: null,
  socket: null,
  lobby: [],
  current: null, // active view with a destroy() method
};

async function api(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

// ── account header ───────────────────────────────────────────────────

function setUser(user) {
  app.user = user;
  topbar.hidden = !user;
  if (!user) return;
  topbar.querySelector('[data-bankroll]').textContent = fmt(user.bankroll);
  topbar.querySelector('[data-inplay]').textContent = fmt(user.inPlay);
  topbar.querySelector('[data-inplay-wrap]').hidden = !user.inPlay;
  topbar.querySelector('[data-username]').textContent = user.username;
  topbar.querySelector('[data-reload]').hidden = !user.canReload;
  app.current?.onUser?.(user);
}

topbar.querySelector('[data-logout]').onclick = async () => {
  await api('logout', {}).catch(() => {});
  app.socket?.disconnect();
  app.socket = null;
  setUser(null);
  location.hash = '';
  showAuth();
};

topbar.querySelector('[data-reload]').onclick = async () => {
  try {
    const { user } = await api('reload', {});
    setUser(user);
    toast('Bankroll reloaded to 10,000 chips', 'info');
  } catch (err) {
    toast(err.message);
  }
};

// ── auth screen ──────────────────────────────────────────────────────

function showAuth() {
  app.current?.destroy?.();
  app.current = null;
  let mode = 'login';
  view.innerHTML = `
    <section class="auth">
      <div class="auth-card panel">
        <div class="auth-logo">♠</div>
        <h1>ALL IN</h1>
        <p class="tagline">No-Limit Texas Hold'em · Play money only</p>
        <div class="tabs" role="tablist">
          <button class="active" data-mode="login" role="tab">Log in</button>
          <button data-mode="register" role="tab">Create account</button>
        </div>
        <form novalidate>
          <label>Username <input class="input" name="username" autocomplete="username" maxlength="16" required></label>
          <label>Password <input class="input" name="password" type="password" autocomplete="current-password" required></label>
          <p class="error" aria-live="polite"></p>
          <button class="btn gold" type="submit">Log in</button>
        </form>
        <p class="fineprint">New players start with <strong>10,000 chips</strong>. No real money, ever.</p>
      </div>
    </section>`;
  const form = view.querySelector('form');
  const submit = form.querySelector('button');
  const error = form.querySelector('.error');
  view.querySelectorAll('[data-mode]').forEach((tab) => {
    tab.onclick = () => {
      mode = tab.dataset.mode;
      view.querySelectorAll('[data-mode]').forEach((t) => t.classList.toggle('active', t === tab));
      submit.textContent = mode === 'login' ? 'Log in' : 'Create account';
      form.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      error.textContent = '';
    };
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      const { user } = await api(mode, { username: form.username.value.trim(), password: form.password.value });
      start(user);
    } catch (err) {
      error.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  };
  form.username.focus();
}

// ── realtime + routing ───────────────────────────────────────────────

function connect() {
  const socket = io({ transports: ['websocket', 'polling'] });
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
    if (err.message === 'unauthorized') {
      socket.disconnect();
      setUser(null);
      showAuth();
    }
  });
  return socket;
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

function start(user) {
  setUser(user);
  if (!app.socket) app.socket = connect();
  if (!location.hash) location.hash = '#/lobby';
  route();
}

window.addEventListener('hashchange', route);

api('me')
  .then(({ user }) => start(user))
  .catch(() => showAuth());
