/* Helpers de apresentacao: escape, datas, modais, toasts. */

export const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const KINDS = {
  tarefa: 'Tarefa', prova: 'Prova', trabalho: 'Trabalho',
  leitura: 'Leitura', apresentacao: 'Apresentação',
};
export const STATUSES = { pendente: 'Pendente', andamento: 'Em andamento', concluida: 'Concluída' };
export const PRIORITIES = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };

export const PALETTE = [
  '#4f46e5', '#0ea5e9', '#059669', '#ca8a04', '#ea580c',
  '#dc2626', '#db2777', '#7c3aed', '#0891b2', '#475569',
];

/* ------------------------------------------------------------------ datas */

/** 'YYYY-MM-DD' -> Date local (evita o deslocamento de fuso do parser ISO). */
export function parseDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function formatDate(iso, opts = {}) {
  const d = parseDate(iso);
  if (!d) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', ...opts });
}

export function daysUntil(iso) {
  const d = parseDate(iso);
  if (!d) return null;
  const today = parseDate(todayISO());
  return Math.round((d - today) / 864e5);
}

/**
 * Etiqueta de prazo. Os tons seguem o design system: a interface e acromatica,
 * entao urgencia proxima usa contraste (chip preenchido) e so o prazo vencido
 * ou de hoje recebe a unica cor semantica da interface.
 */
export function dueLabel(iso, done = false) {
  const days = daysUntil(iso);
  if (days === null) return null;
  const date = formatDate(iso);
  if (done) return { text: date, tone: 'muted' };
  if (days < 0) return { text: `${date} · atrasada ${Math.abs(days)}d`, tone: 'alert' };
  if (days === 0) return { text: 'Hoje', tone: 'alert' };
  if (days === 1) return { text: 'Amanhã', tone: 'strong' };
  if (days <= 7) return { text: `${date} · em ${days}d`, tone: 'strong' };
  return { text: date, tone: 'muted' };
}

export const initials = (name) => String(name || '?')
  .trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase() || '?';

export const avatar = (user, small = false) =>
  `<span class="avatar${small ? ' avatar-sm' : ''}" style="background:${esc(user.color || '#6366f1')}"
     title="${esc(user.name)}">${esc(initials(user.name))}</span>`;

/* ------------------------------------------------------------------ toasts */

export function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

/* ------------------------------------------------------------------ modais */

const modalRoot = () => document.getElementById('modal-root');

/**
 * Abre um modal. `render(close)` devolve o HTML interno; `onMount(root, close)`
 * liga os eventos. Fecha no Esc, no X e no clique fora.
 */
export function openModal({ html, onMount, onClose, compact = false }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="modal${compact ? ' compact' : ''}" role="dialog" aria-modal="true">${html}</div>`;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  modalRoot().append(overlay);

  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  onMount?.(overlay.querySelector('.modal'), close);
  overlay.querySelector('input, select, textarea')?.focus();
  return close;
}

/**
 * Troca o fundo da area atras do modal por uma imagem (ou volta ao veu padrao
 * com null). Recebe o proprio .modal; o fundo e o .overlay que o envolve.
 */
export function setModalBackdrop(modal, url) {
  const overlay = modal?.closest('.overlay');
  if (!overlay) return;
  overlay.classList.toggle('has-backdrop', Boolean(url));
  if (url) overlay.style.setProperty('--backdrop', `url("${url}")`);
  else overlay.style.removeProperty('--backdrop');
}

export function closeAllModals() {
  modalRoot().innerHTML = '';
}

/** Confirmacao simples; Esc e clique fora contam como cancelar. */
export function confirmDialog({ title, message, confirmText = 'Confirmar', danger = true }) {
  return new Promise((resolve) => {
    let answer = false;
    const close = openModal({
      compact: true,
      html: `
        <div class="modal-head"><div><h3>${esc(title)}</h3><p>${esc(message)}</p></div></div>
        <div class="modal-foot">
          <button class="btn" data-act="cancel">Cancelar</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmText)}</button>
        </div>`,
      onMount(root) {
        root.querySelector('[data-act="cancel"]').onclick = () => close();
        root.querySelector('[data-act="ok"]').onclick = () => { answer = true; close(); };
      },
      onClose: () => resolve(answer),
    });
  });
}

/** Marca o botao como ocupado enquanto a promessa roda. */
export async function withBusy(button, fn) {
  if (!button) return fn();
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Salvando...';
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

export function showFormError(root, message) {
  let box = root.querySelector('.form-error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'form-error';
    root.querySelector('.modal-body')?.prepend(box);
  }
  box.textContent = message;
}
