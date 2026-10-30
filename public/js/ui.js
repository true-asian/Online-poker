export const fmt = (n) => Number(n).toLocaleString('en-US');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const SUITS = { s: '♠', h: '♥', d: '♦', c: '♣' };

/** Card markup. `code` is like "As" / "Td", or "xx" for a face-down card. */
export function cardHtml(code, extra = '') {
  if (!code || code === 'xx') return `<div class="card back ${extra}"></div>`;
  const rank = code[0] === 'T' ? '10' : code[0];
  const suit = SUITS[code[1]];
  return `<div class="card suit-${code[1]} ${extra}" data-card="${code}" aria-label="${rank}${suit}">`
    + `<span class="c-rank">${rank}</span><span class="c-suit">${suit}</span><span class="c-pip">${suit}</span></div>`;
}

export function initials(name) {
  const parts = String(name).replace(/[_-]+/g, ' ').trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

/** Stable avatar colour per name. */
export function colorFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 42%)`;
}

/** Replace an element's markup only when it actually changed (keeps animations from replaying). */
export function setHtml(el, html) {
  if (el._html === html) return false;
  el.innerHTML = html;
  el._html = html;
  return true;
}

export function toast(message, kind = 'error') {
  const box = document.querySelector('.toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.remove(), 3800);
}

/**
 * Minimal modal. `body` is trusted markup built by the caller.
 * Resolves with the confirm handler's result, or null if cancelled.
 */
export function openModal({ title, body, confirmText = 'OK', confirmClass = 'gold', onMount, onConfirm }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>
      ${body}
      <div class="modal-actions">
        <button class="btn ghost" data-cancel>Cancel</button>
        <button class="btn ${confirmClass}" data-confirm>${esc(confirmText)}</button>
      </div>
    </div>`;
  document.body.append(backdrop);
  const modal = backdrop.querySelector('.modal');
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') backdrop.querySelector('[data-confirm]').click();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-cancel]').onclick = close;
  backdrop.querySelector('[data-confirm]').onclick = async () => {
    if ((await onConfirm?.(modal)) !== false) close();
  };
  onMount?.(modal);
  backdrop.querySelector('[data-confirm]').focus();
  return close;
}

/** Modal with a chip-amount slider. */
export function amountModal({ title, text, min, max, value, step, confirmText, onConfirm }) {
  return openModal({
    title,
    confirmText,
    body: `
      <p>${esc(text)}</p>
      <div class="amount" data-amount>${fmt(value)}</div>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-range>
      <div class="range-ends"><span>${fmt(min)}</span><span>${fmt(max)}</span></div>`,
    onMount(modal) {
      const range = modal.querySelector('[data-range]');
      range.oninput = () => { modal.querySelector('[data-amount]').textContent = fmt(range.value); };
    },
    onConfirm: (modal) => onConfirm(Number(modal.querySelector('[data-range]').value)),
  });
}

/** Socket.IO emit with an acknowledgement, as a promise. Shows a toast on failure. */
export function request(socket, event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) {
        toast('Connection problem — please try again');
        return resolve({ ok: false });
      }
      if (!res.ok) toast(res.error);
      resolve(res);
    });
  });
}
