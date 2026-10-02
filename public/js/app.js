import { api } from './api.js';
import {
  KINDS, STATUSES, WEEKDAYS, WEEKDAYS_SHORT, avatar, confirmDialog, daysUntil, dueLabel, esc, formatDate, openModal, parseDate, plural, toast, todayISO,
} from './ui.js';
import {
  bindTaskRows, initModals, openInviteForm, openPasswordForm, openPositionForm, openProfileForm, openSemesterForm, openTaskRoleForm, openProfileEditor,
  openSubjectForm, openSubjectModal, openTaskForm, openUserForm, showInviteResult, taskRow,
} from './modals.js';

const root = document.getElementById('root');

/**
 * Marca da Lousa: um quadro de cantos arredondados com o "L" vazado em giz.
 * O vazado (fill-rule evenodd) deixa a superficie aparecer por dentro, entao a
 * marca se inverte sozinha entre os temas — sem segunda versao do arquivo.
 */
const LOGO = `
  <svg class="logo" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" fill-rule="evenodd"
      d="M6 1h12a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5H6a5 5 0 0 1-5-5V6a5 5 0 0 1 5-5zM8 6.5h2.5V15H16v2.5H8z"/>
  </svg>`;

const state = {
  user: null,
  semesters: [],
  semesterId: null,
  subjects: [],
  tasks: [],
  team: [],
  users: [],
  positions: [],
  taskRoles: [], // funcoes numa tarefa: Responsável, Conferente, Quem envia...
  profiles: { profiles: [], groups: [] }, // perfis de acesso + catalogo de direitos
  invites: null, // { mail_enabled, base_is_local, invites: [...] } — so admin
  overview: null,
  view: localStorage.getItem('view') || 'inicio',
  filters: { subject: '', status: '', assignee: '', q: '', showDone: false },
};

initModals({ state, reload: refresh });

/** O perfil de quem esta logado tem este direito? (O servidor confere de novo.) */
const can = (permission) => Boolean(state.user?.permissions?.includes(permission));

/* ============================================================ tema */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
}
applyTheme(localStorage.getItem('theme') || 'light');

/* ============================================================ boot */

async function boot() {
  try {
    // Link de convite (?convite=...) tem prioridade: quem abre ainda nao tem conta.
    const invite = new URLSearchParams(location.search).get('convite');
    if (invite) return renderInvite(invite);

    const status = await api.status();
    if (status.needsSetup) return renderAuth({ setup: true });
    if (!status.user) return renderAuth({ setup: false });
    state.user = status.user;
    await loadAll();
    renderShell();
  } catch (err) {
    root.innerHTML = authPage(`<div class="auth-card">
      <h2>Não foi possível carregar</h2><p class="auth-sub">${esc(err.message)}</p>
      <button class="btn btn-primary" onclick="location.reload()">Tentar de novo</button></div>`);
  }
}

async function loadAll() {
  state.semesters = await api.semesters();
  if (!state.semesters.some((s) => s.id === state.semesterId)) {
    const saved = Number(localStorage.getItem('semesterId'));
    state.semesterId = state.semesters.find((s) => s.id === saved)?.id
      ?? state.semesters.find((s) => s.is_current)?.id
      ?? state.semesters[0]?.id
      ?? null;
  }
  if (state.semesterId) localStorage.setItem('semesterId', state.semesterId);

  [state.team, state.positions, state.taskRoles] = await Promise.all([api.team(), api.positions(), api.taskRoles()]);
  if (state.semesterId) {
    const [subjects, tasks, overview] = await Promise.all([
      api.subjects(state.semesterId),
      api.tasks({ semester: state.semesterId }),
      api.overview(state.semesterId),
    ]);
    Object.assign(state, { subjects, tasks, overview });
  } else {
    Object.assign(state, { subjects: [], tasks: [], overview: null });
  }
  // Cada parte so e pedida por quem tem o direito de ve-la.
  [state.profiles, state.users, state.invites] = await Promise.all([
    api.profiles().catch(() => ({ profiles: [], groups: [] })),
    can('equipe.gerenciar') ? api.users().catch(() => []) : [],
    can('equipe.convidar') ? api.invites().catch(() => null) : null,
  ]);
}

/** Recarrega os dados e repinta a view atual. */
async function refresh() {
  await loadAll();
  renderShell();
}

/* ============================================================ login / setup */

/**
 * Moldura das telas de entrada (login, primeira conta, convite): apresentacao
 * da Lousa de um lado, formulario do outro. No celular, a apresentacao encolhe
 * para uma faixa no topo.
 */
function authPage(inner) {
  return `
    <div class="auth">
      <aside class="auth-side">
        <div class="auth-brand">${LOGO}<span class="wordmark">Lousa</span></div>
        <div class="auth-pitch">
          <h1>O semestre da turma em um quadro só.</h1>
          <p>Matérias, prazos, responsáveis e resumos organizados para toda a equipe.</p>
          <ul class="auth-points">
            <li><strong>Prazos à vista</strong><span>Veja o que vence na semana e o que já atrasou.</span></li>
            <li><strong>Cada um com a sua parte</strong><span>Tarefas com responsáveis e cargos na equipe.</span></li>
            <li><strong>Resumos no lugar certo</strong><span>Anotações e material de estudo de cada matéria.</span></li>
          </ul>
        </div>
      </aside>
      <main class="auth-main">${inner}</main>
    </div>`;
}

const passwordField = (label, name, autocomplete, hint = '') => `
  <div class="field">
    <label for="auth-${name}">${label}</label>
    <div class="password-wrap">
      <input type="password" id="auth-${name}" name="${name}" autocomplete="${autocomplete}" required>
      <button type="button" class="reveal" data-reveal aria-label="Mostrar senha">Mostrar</button>
    </div>
    ${hint ? `<span class="hint">${hint}</span>` : ''}
  </div>`;

/** Botao "Mostrar/Ocultar" ao lado de cada campo de senha. */
function bindReveal(scope) {
  scope.querySelectorAll('[data-reveal]').forEach((button) => {
    button.onclick = () => {
      const input = button.previousElementSibling;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Ocultar' : 'Mostrar';
      button.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
      input.focus();
    };
  });
}

function renderAuth({ setup }) {
  root.innerHTML = authPage(`
    <form class="auth-card" id="auth-form" novalidate>
      <h2>${setup ? 'Criar conta de administrador' : 'Entrar'}</h2>
      <p class="auth-sub">${setup
        ? 'Esta é a primeira conta do sistema e vai administrar a equipe.'
        : 'Use o e-mail e a senha da sua conta.'}</p>
      <div data-slot="error"></div>
      ${setup ? '<div class="field"><label for="auth-name">Nome</label><input type="text" id="auth-name" name="name" autocomplete="name" required></div>' : ''}
      <div class="field"><label for="auth-email">E-mail</label>
        <input type="email" id="auth-email" name="email" autocomplete="username" required></div>
      ${passwordField('Senha', 'password', setup ? 'new-password' : 'current-password', setup ? 'Mínimo de 6 caracteres.' : '')}
      ${setup ? passwordField('Confirmar senha', 'confirm', 'new-password') : `
        <div class="auth-options">
          <label class="auth-check"><input type="checkbox" name="remember" checked> Manter conectado</label>
          <button type="button" class="link-btn" data-act="forgot">Esqueci minha senha</button>
        </div>
        <p class="auth-note" data-slot="forgot" hidden>
          Quem administra a turma pode definir uma senha nova para você em <strong>Equipe → Editar</strong>.
          Depois é só entrar com ela e trocá-la em <strong>Alterar senha</strong>.
        </p>`}
      <button class="btn btn-primary" type="submit">${setup ? 'Criar conta e entrar' : 'Entrar'}</button>
      ${setup ? '' : '<p class="auth-foot">Não tem conta? Peça um convite a quem administra a turma.</p>'}
    </form>`);

  const form = document.getElementById('auth-form');
  bindReveal(form);
  form.querySelector(setup ? '[name="name"]' : '[name="email"]').focus();
  form.querySelector('[data-act="forgot"]')?.addEventListener('click', () => {
    const note = form.querySelector('[data-slot="forgot"]');
    note.hidden = !note.hidden;
  });

  const fail = (message) => {
    form.querySelector('[data-slot="error"]').innerHTML = `<div class="form-error">${esc(message)}</div>`;
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    // Atencao: form.name devolve o atributo do formulario, nao o campo.
    const input = (n) => form.querySelector(`[name="${n}"]`);
    const payload = {
      name: input('name')?.value.trim(),
      email: input('email').value.trim(),
      password: input('password').value,
      remember: input('remember')?.checked ?? true,
    };
    if (setup && !payload.name) return fail('Informe seu nome.');
    if (!payload.email || !payload.password) return fail('Informe o e-mail e a senha.');
    if (setup && payload.password !== input('confirm').value) return fail('As senhas não conferem.');

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { user } = setup ? await api.setup(payload) : await api.login(payload);
      state.user = user;
      await loadAll();
      renderShell();
      toast(`Boas-vindas, ${user.name.split(' ')[0]}!`);
    } catch (err) {
      fail(err.message);
      button.disabled = false;
    }
  };
}

/* ============================================================ convite recebido */

/** Tira o ?convite= da barra: recarregar a pagina nao reabre o convite. */
const dropInviteParam = () => history.replaceState(null, '', location.pathname);

async function renderInvite(token) {
  let info;
  try {
    info = await api.inviteInfo(token);
  } catch (err) {
    root.innerHTML = authPage(`
      <div class="auth-card">
        <h2>Convite inválido</h2>
        <p class="auth-sub">${esc(err.message)}</p>
        <button class="btn btn-primary" id="to-login">Ir para o login</button>
      </div>`);
    document.getElementById('to-login').onclick = () => { dropInviteParam(); boot(); };
    return;
  }

  root.innerHTML = authPage(`
    <form class="auth-card" id="invite-form" novalidate>
      <h2>Você recebeu um convite</h2>
      <p class="auth-sub">${esc(info.invited_by_name || 'A equipe')} convidou você para a Lousa${info.position_name
        ? ` como <strong>${esc(info.position_name)}</strong>` : ''}. Escolha seu nome e uma senha para entrar.</p>
      <div data-slot="error"></div>
      <div class="field"><label>E-mail</label><input type="email" value="${esc(info.email)}" disabled></div>
      <div class="field"><label for="auth-name">Nome</label><input type="text" id="auth-name" name="name" autocomplete="name" required></div>
      ${passwordField('Senha', 'password', 'new-password', 'Mínimo de 6 caracteres.')}
      ${passwordField('Confirmar senha', 'confirm', 'new-password')}
      <button class="btn btn-primary" type="submit">Criar conta e entrar</button>
    </form>`);

  const form = document.getElementById('invite-form');
  bindReveal(form);
  form.querySelector('[name="name"]').focus();
  const fail = (message) => {
    form.querySelector('[data-slot="error"]').innerHTML = `<div class="form-error">${esc(message)}</div>`;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const input = (n) => form.querySelector(`[name="${n}"]`).value;
    if (!input('name').trim()) return fail('Informe seu nome.');
    if (input('password') !== input('confirm')) return fail('As senhas não conferem.');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { user } = await api.acceptInvite(token, { name: input('name').trim(), password: input('password') });
      dropInviteParam();
      state.user = user;
      await loadAll();
      renderShell();
      toast(`Boas-vindas, ${user.name.split(' ')[0]}!`);
    } catch (err) {
      fail(err.message);
      button.disabled = false;
    }
  };
}

/* ============================================================ shell */

// Sem icones decorativos: o design system e tipografico e acromatico.
const NAV = [
  { id: 'inicio', label: 'Visão geral' },
  { id: 'materias', label: 'Matérias' },
  { id: 'tarefas', label: 'Tarefas' },
  { id: 'agenda', label: 'Agenda' },
  { id: 'equipe', label: 'Equipe' },
  { id: 'perfis', label: 'Perfis e acesso' },
];

function renderShell() {
  const openCount = state.tasks.filter((t) => t.status !== 'concluida').length;
  root.innerHTML = `
    <header class="topbar">
      <div class="brand">${LOGO}<span class="wordmark">Lousa</span></div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-ghost btn-sm" id="theme-toggle" title="Alternar tema">
        ${document.documentElement.dataset.theme === 'dark' ? '&#9728;' : '&#9790;'}</button>
      <div class="user-menu">
        <button class="user-chip" id="user-chip" aria-haspopup="menu" aria-expanded="false" title="Minha conta">
          ${avatar(state.user)}
          <span><span class="name">${esc(state.user.name.split(' ')[0])}</span>
          <span class="role">${esc(state.user.profile_name)}</span></span>
          <span class="chevron" aria-hidden="true">&#9662;</span>
        </button>
        <div class="menu" id="user-menu" role="menu" hidden>
          <div class="menu-head">
            <strong>${esc(state.user.name)}</strong>
            <span>${esc(state.user.email)}</span>
          </div>
          <button class="menu-item" role="menuitem" data-menu="profile">Editar perfil</button>
          <button class="menu-item" role="menuitem" data-menu="password">Alterar senha</button>
          ${can('equipe.convidar')
            ? '<button class="menu-item" role="menuitem" data-menu="invite">Convidar participante</button>' : ''}
          <div class="menu-sep"></div>
          <button class="menu-item" role="menuitem" data-menu="logout">Sair</button>
        </div>
      </div>
    </header>
    <div class="shell">
      <nav class="sidebar">
        ${NAV.map((n) => `<button class="nav-item${state.view === n.id ? ' active' : ''}" data-view="${n.id}">
          ${n.label}
          ${n.id === 'tarefas' && openCount ? `<span class="count">${openCount}</span>` : ''}
        </button>`).join('')}
        <div class="nav-sep"></div>
        ${can('materias.editar') ? '<button class="nav-item" id="quick-subject">+ Nova matéria</button>' : ''}
        ${can('tarefas.editar') ? '<button class="nav-item" id="quick-task">+ Nova tarefa</button>' : ''}
      </nav>
      <main class="content"><div class="content-inner" id="view"></div></main>
    </div>`;

  document.getElementById('theme-toggle').onclick = () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    renderShell();
  };
  bindUserMenu();
  root.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => goTo(b.dataset.view);
  });
  document.getElementById('quick-subject')?.addEventListener('click', () => requireSemester(() => openSubjectForm(null, refresh)));
  document.getElementById('quick-task')?.addEventListener('click', () => requireSemester(() => {
    if (!state.subjects.length) return toast('Cadastre uma matéria antes de criar tarefas.', 'error');
    openTaskForm({ subject_id: state.subjects[0].id }, refresh);
  }));

  renderView();
}

/** O listener do documento e unico: renderShell roda de novo a cada refresh. */
let closeUserMenu = () => {};
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.user-menu')) closeUserMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUserMenu(); });

function bindUserMenu() {
  const chip = document.getElementById('user-chip');
  const menu = document.getElementById('user-menu');
  const setOpen = (open) => {
    menu.hidden = !open;
    chip.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('.menu-item')?.focus();
  };
  closeUserMenu = () => setOpen(false);
  chip.onclick = () => setOpen(menu.hidden);

  const actions = {
    profile: () => openProfileForm(async (user) => { state.user = { ...state.user, ...user }; await refresh(); }),
    password: () => openPasswordForm(),
    invite: () => openInviteForm(refresh),
    logout: async () => { await api.logout(); location.reload(); },
  };
  menu.querySelectorAll('[data-menu]').forEach((item) => {
    item.onclick = () => { setOpen(false); actions[item.dataset.menu](); };
  });
}

async function onSemesterSaved(newId) {
  if (newId) {
    state.semesterId = newId;
    localStorage.setItem('semesterId', newId);
  } else {
    state.semesterId = null;
  }
  await refresh();
}

function requireSemester(fn) {
  if (!state.semesterId) return toast('Crie um semestre primeiro na Visão geral.', 'error');
  fn();
}

function goTo(view) {
  state.view = view;
  localStorage.setItem('view', view);
  renderShell();
}

/* ============================================================ views */

function renderView() {
  const view = document.getElementById('view');
  // Tarefas e Agenda dependem do semestre; Visao geral e Materias tem o
  // proprio seletor (e o convite para criar o primeiro), Equipe nao usa.
  if (!state.semesterId && ['tarefas', 'agenda'].includes(state.view)) {
    view.innerHTML = `
      <div class="empty" style="margin-top:40px">
        <strong>Nenhum semestre selecionado</strong>
        Escolha ou crie um semestre na Visão geral.
        <div style="margin-top:14px"><button class="btn btn-primary" id="go-home">Ir para a Visão geral</button></div>
      </div>`;
    document.getElementById('go-home').onclick = () => goTo('inicio');
    return;
  }
  ({
    inicio: viewHome, materias: viewSubjects, tarefas: viewTasks, agenda: viewAgenda, equipe: viewTeam, perfis: viewProfiles,
  }[state.view] ?? viewHome)(view);
}

/* ------------------------------------------------------------ visao geral */

function semesterPicker() {
  return `
    <div class="semester-picker">
      <label for="semester-select">Semestre</label>
      <select id="semester-select">
        ${state.semesters.map((s) => `<option value="${s.id}"${s.id === state.semesterId ? ' selected' : ''}>
          ${esc(s.name)}${s.is_current ? ' (atual)' : ''}</option>`).join('')}
        ${state.semesters.length ? '' : '<option value="">Nenhum semestre</option>'}
      </select>
      ${can('semestres.editar') ? `<button class="btn btn-sm" id="semester-edit" title="Editar semestre"${state.semesterId ? '' : ' disabled'}>Editar</button>` : ''}
      ${can('semestres.criar') ? '<button class="btn btn-sm" id="semester-new" title="Novo semestre">+ Novo</button>' : ''}
    </div>`;
}

function bindSemesterPicker(view) {
  view.querySelector('#semester-select').onchange = async (e) => {
    state.semesterId = Number(e.target.value) || null;
    localStorage.setItem('semesterId', state.semesterId ?? '');
    await refresh();
  };
  view.querySelector('#semester-new')?.addEventListener('click', () => openSemesterForm(null, onSemesterSaved));
  view.querySelector('#semester-edit')?.addEventListener('click', () => {
    const semester = state.semesters.find((s) => s.id === state.semesterId);
    if (semester) openSemesterForm(semester, onSemesterSaved);
  });
}

/**
 * Uma linha por integrante, com as entregas DO SEMESTRE selecionado.
 * Tudo sai de state.tasks (ja filtrado pelo semestre e com responsaveis).
 */
function memberSummaries() {
  const byDue = (a, b) => a.due_date.localeCompare(b.due_date);
  return state.team.map((user) => {
    const mine = state.tasks.filter((t) => t.assignees.some((a) => a.id === user.id));
    const open = mine.filter((t) => t.status !== 'concluida');
    const days = (t) => daysUntil(t.due_date);
    return {
      user,
      open: open.length,
      doing: open.filter((t) => t.status === 'andamento').length,
      late: open.filter((t) => t.due_date && days(t) < 0).length,
      week: open.filter((t) => t.due_date && days(t) >= 0 && days(t) <= 7).length,
      done: mine.length - open.length,
      next: open.filter((t) => t.due_date && days(t) >= 0).sort(byDue)[0] ?? null,
    };
  });
}

function teamTable() {
  const rows = memberSummaries();
  const unassigned = state.tasks.filter((t) => t.status !== 'concluida' && !t.assignees.length).length;
  const num = (n, tone = '') => (n ? `<span class="num${tone}">${n}</span>` : '<span class="num zero">0</span>');

  return `
    <div class="table-wrap"><table class="table wide">
      <thead><tr>
        <th>Integrante</th><th>Cargo</th><th class="c">A fazer</th><th class="c">Em andamento</th>
        <th class="c">Atrasadas</th><th class="c">Vencem em 7 dias</th><th class="c">Concluídas</th><th>Próxima entrega</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => {
          const due = r.next ? dueLabel(r.next.due_date) : null;
          return `<tr class="row-link" data-member="${r.user.id}" tabindex="0" title="Ver tarefas de ${esc(r.user.name)}">
            <td><div class="member-cell">${avatar(r.user)}<strong>${esc(r.user.name)}</strong>
              ${r.user.id === state.user.id ? '<span class="pill muted">você</span>' : ''}</div></td>
            <td>${r.user.position_name ? esc(r.user.position_name) : '<span class="muted-text">--</span>'}</td>
            <td class="c">${num(r.open)}</td>
            <td class="c">${num(r.doing)}</td>
            <td class="c">${num(r.late, ' alert')}</td>
            <td class="c">${num(r.week)}</td>
            <td class="c">${num(r.done)}</td>
            <td>${r.next
              ? `<div class="next-due"><span class="next-title">${esc(r.next.title)}</span>
                 <span class="pill ${due.tone}">${esc(due.text)}</span></div>`
              : '<span class="muted-text">Nada pendente</span>'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
    ${unassigned ? `<p class="hint table-note">${plural(unassigned, 'tarefa aberta', 'tarefas abertas')} sem responsável.</p>` : ''}`;
}

/** Abre a lista de Tarefas ja filtrada por uma pessoa. */
function showTasksOf(userId) {
  Object.assign(state.filters, { assignee: String(userId), subject: '', status: '', q: '', showDone: false });
  goTo('tarefas');
}

/** Linhas da tabela de integrantes (aba Equipe) levam as tarefas da pessoa. */
function bindMemberRows(view) {
  view.querySelectorAll('[data-member]').forEach((row) => {
    row.onclick = () => showTasksOf(row.dataset.member);
    row.onkeydown = (e) => { if (e.key === 'Enter') showTasksOf(row.dataset.member); };
  });
}

/* ------------------------------------------------------------ visao geral: area pessoal */

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dueISO = (t) => (t.due_date ? String(t.due_date).slice(0, 10) : null);

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  return h < 18 ? 'Boa tarde' : 'Boa noite';
}

/**
 * O que a Visao geral mostra sobre quem esta logado. Sai de state.tasks, que
 * ja vem filtrado pelo semestre selecionado e com as pessoas de cada tarefa.
 */
function myDashboard() {
  const me = state.user.id;
  const mine = state.tasks.filter((t) => t.assignees.some((a) => a.id === me));
  const open = mine.filter((t) => t.status !== 'concluida');
  const days = (t) => daysUntil(t.due_date);
  const byDue = (a, b) => dueISO(a).localeCompare(dueISO(b));
  const upcoming = open.filter((t) => t.due_date && days(t) >= 0).sort(byDue);

  // Funcoes que a pessoa ocupa nas tarefas abertas: "Responsável · 3".
  const roles = new Map();
  for (const t of open) {
    for (const a of t.assignees) {
      if (a.id !== me) continue;
      const name = a.role_name || 'Sem função';
      roles.set(name, (roles.get(name) ?? 0) + 1);
    }
  }

  return {
    mine,
    open,
    upcoming,
    late: open.filter((t) => t.due_date && days(t) < 0).sort(byDue),
    week: upcoming.filter((t) => days(t) <= 7),
    undated: open.filter((t) => !t.due_date),
    doing: open.filter((t) => t.status === 'andamento'),
    done: mine.length - open.length,
    roles: [...roles].sort((a, b) => b[1] - a[1]),
    bySubject: state.subjects
      .map((s) => ({ subject: s, count: open.filter((t) => t.subject_id === s.id).length }))
      .filter((x) => x.count)
      .sort((a, b) => b.count - a.count),
  };
}

/** Frase de abertura: a situacao da pessoa numa linha. */
function headline(d) {
  if (!d.mine.length) return 'Nenhuma tarefa com você neste semestre.';
  if (!d.open.length) return 'Tudo em dia: nenhuma entrega pendente com você.';
  const late = plural(d.late.length, 'entrega atrasada', 'entregas atrasadas');
  const week = `${plural(d.week.length, 'entrega', 'entregas')} nos próximos 7 dias`;
  if (d.late.length && d.week.length) return `Você tem ${late} e ${week}.`;
  if (d.late.length) return `Você tem ${late}. Nos próximos 7 dias, nenhuma entrega sua vence.`;
  if (d.week.length) return `Você tem ${week}.`;
  return 'Nenhuma entrega sua vence nos próximos 7 dias.';
}

/** Destaque do topo: a entrega mais urgente (atrasada antes, depois a proxima). */
function focusCard(d) {
  const t = d.late[0] ?? d.upcoming[0];
  if (!t) {
    return `
      <div class="focus-card calm">
        <div class="focus-count"><span class="focus-big">&#10003;</span></div>
        <div class="focus-main">
          <span class="focus-kicker">Próxima entrega</span>
          <strong class="focus-title">${d.open.length ? 'Nenhum prazo marcado' : 'Nada pendente com você'}</strong>
          <span class="focus-meta">${d.undated.length
            ? `${plural(d.undated.length, 'tarefa aberta', 'tarefas abertas')} sem prazo definido.`
            : 'Aproveite para adiantar a leitura ou revisar os resumos.'}</span>
        </div>
      </div>`;
  }
  const n = daysUntil(t.due_date);
  const late = n < 0;
  const big = late ? Math.abs(n) : n === 0 ? 'Hoje' : n;
  let unit = '';
  if (late) unit = Math.abs(n) === 1 ? 'dia de atraso' : 'dias de atraso';
  else if (n > 0) unit = n === 1 ? 'dia' : 'dias';
  const myRoles = t.assignees.filter((a) => a.id === state.user.id && a.role_name).map((a) => a.role_name);
  return `
    <button class="focus-card${n <= 0 ? ' alert' : ''}" data-open-task="${t.id}" style="--card-color:${esc(t.subject_color)}">
      <div class="focus-count"><span class="focus-big">${big}</span>${unit ? `<span class="focus-unit">${unit}</span>` : ''}</div>
      <div class="focus-main">
        <span class="focus-kicker">${late ? 'Atrasada' : 'Próxima entrega'} · ${esc(KINDS[t.kind] || t.kind)}</span>
        <strong class="focus-title">${esc(t.title)}</strong>
        <span class="focus-meta">
          <span class="subject-dot" style="background:${esc(t.subject_color)}"></span>${esc(t.subject_name)}
          · ${esc(formatDate(t.due_date, { weekday: 'long' }))}${myRoles.length ? ` · você: ${esc(myRoles.join(', '))}` : ''}
        </span>
      </div>
    </button>`;
}

function myStats(d) {
  const total = d.mine.length;
  const pct = total ? Math.round((d.done / total) * 100) : 0;
  return `
    <div class="stats home-stats">
      <div class="stat${d.late.length ? ' alert' : ''}"><div class="value">${d.late.length}</div><div class="label">Atrasadas</div></div>
      <div class="stat"><div class="value">${d.week.length}</div><div class="label">Vencem em 7 dias</div></div>
      <div class="stat"><div class="value">${d.doing.length}</div><div class="label">Em andamento</div></div>
      <div class="stat">
        <div class="value">${pct}%</div>
        <div class="label">${total ? `${d.done} de ${total} concluídas` : 'Sem tarefas ainda'}</div>
        <div class="stat-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
      </div>
    </div>`;
}

/**
 * Os proximos 7 dias, a partir de hoje: em cada dia, a carga (barra), as
 * entregas da pessoa e as aulas da turma.
 */
function weekStrip(d) {
  const base = parseDate(todayISO());
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(base);
    day.setDate(base.getDate() + i);
    return day;
  });
  const dueOn = (iso) => d.open.filter((t) => dueISO(t) === iso);
  const busiest = Math.max(1, ...days.map((day) => dueOn(isoOf(day)).length));

  return `
    <div class="week-strip">
      ${days.map((day, i) => {
        const tasks = dueOn(isoOf(day));
        const classes = state.subjects
          .flatMap((s) => s.classes.filter((c) => c.weekday === day.getDay()).map((c) => ({ ...c, subject: s })))
          .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));
        const name = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : WEEKDAYS_SHORT[day.getDay()];
        return `
          <div class="day-col${i === 0 ? ' today' : ''}${tasks.length ? ' busy' : ''}">
            <button class="day-head" data-cal-day="${isoOf(day)}" title="Ver o dia no calendário">
              <span class="day-name">${name}</span>
              <span class="day-date">${String(day.getDate()).padStart(2, '0')}/${String(day.getMonth() + 1).padStart(2, '0')}</span>
            </button>
            <div class="day-load" title="${plural(tasks.length, 'entrega', 'entregas')}">
              <span style="width:${(tasks.length / busiest) * 100}%"></span>
            </div>
            <div class="day-count">${tasks.length ? plural(tasks.length, 'entrega', 'entregas') : 'livre'}</div>
            ${tasks.map((t) => `
              <button class="day-task" data-open-task="${t.id}" style="--card-color:${esc(t.subject_color)}"
                      title="${esc(t.title)} · ${esc(t.subject_name)}">${esc(t.title)}</button>`).join('')}
            ${classes.map((c) => `
              <button class="day-class" data-open-subject="${c.subject.id}" style="--card-color:${esc(c.subject.color)}"
                      title="Aula de ${esc(c.subject.name)}${c.room ? ` · sala ${esc(c.room)}` : ''}">
                ${c.starts_at ? `<span class="mono">${esc(c.starts_at)}</span> ` : ''}${esc(c.subject.name)}</button>`).join('')}
          </div>`;
      }).join('')}
    </div>`;
}

/* ------------------------------------------------------------ calendario */

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/**
 * O que acontece num dia: aulas (pelo dia da semana, dentro do periodo do
 * semestre quando ele tem datas) e entregas da turma com prazo naquele dia.
 */
function dayAgenda(iso) {
  const semester = state.semesters.find((s) => s.id === state.semesterId);
  const inTerm = (!semester?.starts_on || iso >= String(semester.starts_on).slice(0, 10))
    && (!semester?.ends_on || iso <= String(semester.ends_on).slice(0, 10));
  const weekday = parseDate(iso).getDay();
  const classes = inTerm ? state.subjects
    .flatMap((s) => s.classes.filter((c) => c.weekday === weekday).map((c) => ({ ...c, subject: s })))
    .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? '')) : [];
  const tasks = state.tasks.filter((t) => dueISO(t) === iso);
  const isMine = (t) => t.assignees.some((a) => a.id === state.user.id);
  return { classes, tasks, isMine };
}

/** Grade do mes: semanas comecando no domingo, com os dias vizinhos apagados. */
function monthGrid(year, month, selected) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const today = todayISO();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
  // Seis semanas so quando o mes precisa; senao a ultima linha seria toda de fora.
  const weeks = cells[35].getMonth() === month ? 6 : 5;

  return `
    <div class="cal-grid">
      ${WEEKDAYS_SHORT.map((w) => `<div class="cal-weekday">${w}</div>`).join('')}
      ${cells.slice(0, weeks * 7).map((day) => {
        const iso = isoOf(day);
        const { classes, tasks, isMine } = dayAgenda(iso);
        const open = tasks.filter((t) => t.status !== 'concluida');
        const mine = open.filter(isMine).length;
        const urgent = open.some((t) => daysUntil(t.due_date) <= 0);
        const cls = [
          'cal-day',
          day.getMonth() !== month ? 'outside' : '',
          iso === today ? 'today' : '',
          iso === selected ? 'selected' : '',
        ].filter(Boolean).join(' ');
        return `
          <button class="${cls}" data-day="${iso}" aria-pressed="${iso === selected}"
                  aria-label="${esc(formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long' }))}">
            <span class="cal-num">${day.getDate()}</span>
            <span class="cal-marks">
              ${classes.slice(0, 4).map((c) => `<span class="cal-class" style="background:${esc(c.subject.color)}"></span>`).join('')}
            </span>
            ${open.length ? `<span class="cal-due${urgent ? ' alert' : ''}${mine ? ' mine' : ''}"
              title="${plural(open.length, 'entrega', 'entregas')}${mine ? `, ${plural(mine, 'sua', 'suas')}` : ''}">${open.length}</span>` : ''}
          </button>`;
      }).join('')}
    </div>`;
}

/** Painel do dia escolhido: aulas e entregas, cada uma clicavel. */
function dayDetail(iso) {
  const { classes, tasks, isMine } = dayAgenda(iso);
  const title = formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });
  const n = daysUntil(iso);
  const when = n === 0 ? 'Hoje' : n === 1 ? 'Amanhã' : n === -1 ? 'Ontem' : '';

  return `
    <div class="cal-detail-head">
      ${when ? `<span class="focus-kicker">${when}</span>` : ''}
      <h4>${esc(title.charAt(0).toUpperCase() + title.slice(1))}</h4>
    </div>
    <div class="cal-detail-section">
      <h5>Aulas</h5>
      ${classes.length ? classes.map((c) => `
        <button class="cal-item" data-cal-subject="${c.subject.id}" style="--card-color:${esc(c.subject.color)}">
          <strong>${esc(c.subject.name)}</strong>
          <span>${c.starts_at ? `${esc(c.starts_at)}${c.ends_at ? ` – ${esc(c.ends_at)}` : ''}` : 'Horário a definir'}${c.room ? ` · sala ${esc(c.room)}` : ''}</span>
        </button>`).join('') : '<p class="muted-text">Sem aula.</p>'}
    </div>
    <div class="cal-detail-section">
      <h5>Entregas</h5>
      ${tasks.length ? tasks.map((t) => {
        const done = t.status === 'concluida';
        return `
        <button class="cal-item${done ? ' done' : ''}" data-cal-task="${t.id}" style="--card-color:${esc(t.subject_color)}">
          <strong>${esc(t.title)}</strong>
          <span>${esc(t.subject_name)} · ${esc(KINDS[t.kind] || t.kind)}</span>
          <span class="cal-item-tags">
            ${done ? '<span class="pill muted">Concluída</span>' : t.status === 'andamento' ? '<span class="pill muted">Em andamento</span>' : ''}
            ${isMine(t) ? '<span class="pill strong">Sua</span>' : ''}
            ${t.everyone?.length ? '<span class="pill">Todos</span>' : ''}
            ${!done && daysUntil(t.due_date) < 0 ? '<span class="pill alert">Atrasada</span>' : ''}
          </span>
        </button>`;
      }).join('') : '<p class="muted-text">Nenhuma entrega neste dia.</p>'}
    </div>`;
}

/** Modal com o mes inteiro; o dia clicado abre os detalhes ao lado. */
function openCalendar(startISO = todayISO()) {
  let selected = startISO;
  let cursor = parseDate(startISO);
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);

  openModal({
    html: `
      <div class="modal-head">
        <div><h3>Calendário</h3><p>Aulas da turma e entregas do semestre. Clique num dia para ver os detalhes.</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body cal-body">
        <div class="cal-main">
          <div class="cal-nav">
            <button class="btn btn-sm" data-cal="prev" aria-label="Mês anterior">&larr;</button>
            <strong class="cal-month" data-cal-month></strong>
            <button class="btn btn-sm" data-cal="next" aria-label="Próximo mês">&rarr;</button>
            <div class="spacer"></div>
            <button class="btn btn-sm btn-ghost" data-cal="today">Hoje</button>
          </div>
          <div data-cal-grid></div>
          <div class="cal-legend">
            <span><span class="cal-class"></span>aula</span>
            <span><span class="cal-due">2</span>entregas</span>
            <span><span class="cal-due mine">2</span>tem entrega sua</span>
            <span><span class="cal-due alert">2</span>hoje ou atrasada</span>
          </div>
        </div>
        <aside class="cal-detail" data-cal-detail aria-live="polite"></aside>
      </div>`,
    onMount(root, close) {
      root.classList.add('cal-modal');
      const grid = root.querySelector('[data-cal-grid]');
      const detail = root.querySelector('[data-cal-detail]');
      const monthLabel = root.querySelector('[data-cal-month]');

      const paintDetail = () => {
        detail.innerHTML = dayDetail(selected);
        // Abrir tarefa ou materia fecha o calendario: ao salvar, a tela recarrega.
        detail.querySelectorAll('[data-cal-task]').forEach((el) => {
          el.onclick = () => {
            const task = state.tasks.find((t) => t.id === Number(el.dataset.calTask));
            close();
            if (task && can('tarefas.editar')) openTaskForm(task, refresh);
            else if (task) openSubjectModal(task.subject_id, 'tasks');
          };
        });
        detail.querySelectorAll('[data-cal-subject]').forEach((el) => {
          el.onclick = () => { close(); openSubjectModal(Number(el.dataset.calSubject), 'dates'); };
        });
      };
      const paint = () => {
        monthLabel.textContent = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
        grid.innerHTML = monthGrid(cursor.getFullYear(), cursor.getMonth(), selected);
        grid.querySelectorAll('[data-day]').forEach((el) => {
          el.onclick = () => {
            selected = el.dataset.day;
            const day = parseDate(selected);
            // Dia de outro mes (as pontas da grade) leva para aquele mes.
            if (day.getMonth() !== cursor.getMonth()) cursor = new Date(day.getFullYear(), day.getMonth(), 1);
            paint();
          };
        });
        paintDetail();
      };
      const shift = (months) => {
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + months, 1);
        paint();
      };
      root.querySelector('[data-cal="prev"]').onclick = () => shift(-1);
      root.querySelector('[data-cal="next"]').onclick = () => shift(1);
      root.querySelector('[data-cal="today"]').onclick = () => {
        selected = todayISO();
        cursor = new Date(parseDate(selected).getFullYear(), parseDate(selected).getMonth(), 1);
        paint();
      };
      paint();
    },
  });
}

/** Barras: quantas tarefas abertas da pessoa em cada materia. */
function subjectLoad(d) {
  if (!d.bySubject.length) return '<p class="muted-text side-empty">Nenhuma tarefa aberta com você.</p>';
  const max = d.bySubject[0].count;
  return d.bySubject.map(({ subject: s, count }) => `
    <button class="load-row" data-open-subject="${s.id}" title="Abrir ${esc(s.name)}">
      <span class="load-name"><span class="subject-dot" style="background:${esc(s.color)}"></span>${esc(s.name)}</span>
      <span class="load-bar"><span style="width:${(count / max) * 100}%;background:${esc(s.color)}"></span></span>
      <span class="num">${count}</span>
    </button>`).join('');
}

function viewHome(view) {
  const semester = state.semesters.find((s) => s.id === state.semesterId);
  const firstName = esc(state.user.name.split(' ')[0]);
  const longDate = formatDate(todayISO(), { weekday: 'long', day: 'numeric', month: 'long' });
  const today = longDate.charAt(0).toUpperCase() + longDate.slice(1);

  if (!semester) {
    view.innerHTML = `
      <div class="page-head">
        <div><h2>${greeting()}, ${firstName}</h2><p>${esc(today)}</p></div>
        <div class="spacer"></div>
        ${semesterPicker()}
      </div>
      ${noSemester()}`;
    bindSemesterPicker(view);
    bindSubjects(view);
    return;
  }

  const d = myDashboard();
  const o = state.overview ?? {};
  const unassigned = state.tasks.filter((t) => t.status !== 'concluida' && !t.assignees.length).length;
  const deadlines = [...d.late, ...d.upcoming];
  const LIST_MAX = 6;

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h2>${greeting()}, ${firstName}</h2>
        <p>${esc(today)} · ${esc(headline(d))}</p>
      </div>
      <div class="spacer"></div>
      ${semesterPicker()}
    </div>

    <div class="home-top">
      ${focusCard(d)}
      ${myStats(d)}
    </div>

    <section class="home-section">
      <div class="section-head">
        <div><h3>Sua semana</h3><p class="section-sub">Suas entregas e as aulas da turma nos próximos 7 dias.</p></div>
        <button class="btn btn-sm" data-act="calendar">Calendário</button>
      </div>
      ${weekStrip(d)}
    </section>

    <div class="home-grid">
      <section class="home-section">
        <div class="section-head">
          <div><h3>Seus prazos</h3><p class="section-sub">${d.late.length ? 'Atrasadas primeiro, depois as próximas.' : 'Das mais próximas às mais distantes.'}</p></div>
          ${d.open.length ? `<button class="btn btn-sm" data-act="my-tasks">Ver todas as minhas (${d.open.length})</button>` : ''}
        </div>
        ${deadlines.length
          ? `<div class="list">${deadlines.slice(0, LIST_MAX).map((t) => taskRow(t, true)).join('')}</div>
             ${deadlines.length > LIST_MAX ? `<p class="hint table-note">E mais ${deadlines.length - LIST_MAX} com prazo.</p>` : ''}`
          : `<div class="empty"><strong>Nenhum prazo com você</strong>${unassigned
              ? `Há ${plural(unassigned, 'tarefa aberta', 'tarefas abertas')} da turma sem responsável.`
              : 'Quando alguém colocar você numa tarefa, ela aparece aqui.'}</div>`}
        ${d.undated.length && deadlines.length ? `<p class="hint table-note">${plural(d.undated.length, 'tarefa aberta', 'tarefas abertas')} sem prazo.</p>` : ''}
      </section>

      <aside class="home-side">
        <div class="side-card">
          <h4>Por matéria</h4>
          ${subjectLoad(d)}
        </div>
        ${d.roles.length ? `
          <div class="side-card">
            <h4>Suas funções</h4>
            <div class="role-chips">${d.roles.map(([name, n]) => `<span class="pill">${esc(name)} <span class="num">${n}</span></span>`).join('')}</div>
          </div>` : ''}
        <div class="side-card">
          <h4>Turma</h4>
          <div class="class-pulse">
            <div><span class="num">${o.open_tasks ?? 0}</span><span>abertas</span></div>
            <div><span class="num${o.late_tasks ? ' alert' : ''}">${o.late_tasks ?? 0}</span><span>atrasadas</span></div>
            <div><span class="num${unassigned ? ' alert' : ''}">${unassigned}</span><span>sem responsável</span></div>
          </div>
          <button class="btn btn-sm btn-ghost side-link" data-act="go-team">Entregas por integrante &rarr;</button>
        </div>
      </aside>
    </div>`;

  bindSemesterPicker(view);
  bindTaskRows(view, state.tasks, refresh);

  view.querySelectorAll('[data-open-task]').forEach((el) => {
    el.onclick = () => {
      const task = state.tasks.find((t) => t.id === Number(el.dataset.openTask));
      if (!task) return;
      if (can('tarefas.editar')) openTaskForm(task, refresh);
      else openSubjectModal(task.subject_id, 'tasks');
    };
  });
  view.querySelectorAll('[data-open-subject]').forEach((el) => {
    el.onclick = () => openSubjectModal(Number(el.dataset.openSubject), 'tasks');
  });
  view.querySelector('[data-act="my-tasks"]')?.addEventListener('click', () => showTasksOf(state.user.id));
  view.querySelector('[data-act="go-team"]').onclick = () => goTo('equipe');
  view.querySelector('[data-act="calendar"]').onclick = () => openCalendar();
  view.querySelectorAll('[data-cal-day]').forEach((el) => {
    el.onclick = () => openCalendar(el.dataset.calDay);
  });
}

/* ------------------------------------------------------------ materias */

const noSemester = () => `
  <div class="empty">
    <strong>Comece criando um semestre</strong>
    Ex.: 2026.1. Depois, cadastre as matérias, os professores, os dias de aula e as tarefas.
    ${can('semestres.criar') ? '<div style="margin-top:14px"><button class="btn btn-primary" id="first-semester">Criar semestre</button></div>' : ''}
  </div>`;

/** Dias de aula sem repeticao, abreviados: "Seg · Qua". */
const classDays = (s) => s.classes
  .map((c) => WEEKDAYS[c.weekday].slice(0, 3))
  .filter((v, i, a) => a.indexOf(v) === i);

/** Aba Materias: os cartoes, com a imagem de capa de cada materia. */
function viewSubjects(view) {
  const semester = state.semesters.find((s) => s.id === state.semesterId);
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Matérias</h2>
        <p>${semester ? `${plural(state.subjects.length, 'matéria', 'matérias')} em ${esc(semester.name)}` : 'Comece criando um semestre.'}</p>
      </div>
      <div class="spacer"></div>
      ${semesterPicker()}
    </div>
    ${!semester ? noSemester() : `
      <div class="grid">
        ${state.subjects.map(subjectCard).join('')}
        ${can('materias.editar') ? '<button class="add-card" data-act="new-subject"><span style="font-size:22px">+</span>Nova matéria</button>' : ''}
      </div>`}`;

  bindSemesterPicker(view);
  bindSubjects(view);
}

/** Liga o que as duas telas de materias tem em comum: abrir, editar, criar. */
function bindSubjects(view) {
  view.querySelector('#first-semester')?.addEventListener('click', () => openSemesterForm(null, onSemesterSaved));
  view.querySelectorAll('[data-act="new-subject"]').forEach((b) => {
    b.onclick = () => openSubjectForm(null, refresh);
  });
  view.querySelectorAll('[data-subject]').forEach((el) => {
    const open = () => openSubjectModal(Number(el.dataset.subject));
    el.onclick = open;
    // A linha da tabela nao e botao: o Enter precisa ser ligado a mao.
    if (el.tagName === 'TR') el.onkeydown = (e) => { if (e.key === 'Enter' && e.target === el) open(); };
  });
  view.querySelectorAll('[data-edit-subject]').forEach((b) => {
    b.onclick = async (e) => {
      // Na lista o Editar fica dentro da linha clicavel: nao deixa abrir o modal junto.
      e.stopPropagation();
      // O formulario precisa da materia completa (observacoes, aulas, imagens).
      try { openSubjectForm(await api.subject(Number(b.dataset.editSubject)), refresh); }
      catch (err) { toast(err.message, 'error'); }
    };
  });
}

function subjectCard(s) {
  const due = dueLabel(s.next_due);
  const days = classDays(s);

  // Duas etiquetas no maximo: com a tipografia do design system, uma terceira
  // seria cortada. As demais informacoes aparecem ao abrir a materia.
  const pills = [
    days.length ? `<span class="pill">${esc(days.join(' · '))}</span>` : null,
    due ? `<span class="pill ${due.tone}">${esc(due.text)}</span>` : null,
    s.open_tasks
      ? `<span class="pill strong">${plural(s.open_tasks, 'tarefa', 'tarefas')}</span>`
      : '<span class="pill muted">Em dia</span>',
    s.note_count ? `<span class="pill muted">${plural(s.note_count, 'resumo', 'resumos')}</span>` : null,
  ].filter(Boolean);

  // O Editar fica fora do cartao: botao dentro de botao nao e HTML valido.
  const cover = api.subjectImageUrl(s, 'cover');
  return `
    <div class="subject-cell">
      <button class="subject-card${cover ? ' has-cover' : ''}" data-subject="${s.id}"
              style="--card-color:${esc(s.color)}${cover ? `;--cover:url('${esc(cover)}')` : ''}"
              title="${esc(s.name)}">
        <div class="code">${s.code ? esc(s.code) : ''}</div>
        <h3>${esc(s.name)}</h3>
        <div class="prof">${s.professor ? esc(s.professor) : 'Sem professor cadastrado'}</div>
        <div class="meta">${pills.slice(0, 2).join('')}</div>
      </button>
      ${can('materias.editar') ? `<button class="btn btn-sm card-edit" data-edit-subject="${s.id}" title="Editar ${esc(s.name)}">Editar</button>` : ''}
    </div>`;
}

/* ------------------------------------------------------------ tarefas */

function viewTasks(view) {
  const f = state.filters;
  const q = f.q.toLowerCase();
  const visible = state.tasks.filter((t) => {
    if (!f.showDone && t.status === 'concluida') return false;
    if (f.subject && t.subject_id !== Number(f.subject)) return false;
    if (f.status && t.status !== f.status) return false;
    if (f.assignee && !t.assignees.some((a) => a.id === Number(f.assignee))) return false;
    if (q && !(`${t.title} ${t.description ?? ''} ${t.subject_name}`.toLowerCase().includes(q))) return false;
    return true;
  });

  view.innerHTML = `
    <div class="page-head">
      <div><h2>Tarefas</h2><p>${visible.length} de ${plural(state.tasks.length, 'tarefa', 'tarefas')}</p></div>
      <div class="spacer"></div>
      ${can('tarefas.editar') ? '<button class="btn btn-primary" data-act="new-task">+ Nova tarefa</button>' : ''}
    </div>
    <div class="toolbar">
      <input type="search" id="f-q" placeholder="Buscar..." value="${esc(f.q)}">
      <select id="f-subject"><option value="">Todas as matérias</option>
        ${state.subjects.map((s) => `<option value="${s.id}"${String(s.id) === f.subject ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <select id="f-status"><option value="">Qualquer situação</option>
        ${Object.entries(STATUSES).map(([v, l]) => `<option value="${v}"${v === f.status ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select id="f-assignee"><option value="">Qualquer responsável</option>
        ${state.team.map((u) => `<option value="${u.id}"${String(u.id) === f.assignee ? ' selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      <label class="check-chip${f.showDone ? ' on' : ''}">
        <input type="checkbox" id="f-done"${f.showDone ? ' checked' : ''}> Mostrar concluídas</label>
    </div>
    ${visible.length
      ? `<div class="list">${visible.map((t) => taskRow(t, true)).join('')}</div>`
      : `<div class="empty"><strong>Nada por aqui</strong>${state.tasks.length
          ? 'Nenhuma tarefa corresponde aos filtros.' : 'Crie a primeira tarefa da turma.'}</div>`}`;

  const newTask = view.querySelector('[data-act="new-task"]');
  if (newTask) newTask.onclick = () => {
    if (!state.subjects.length) return toast('Cadastre uma matéria antes de criar tarefas.', 'error');
    openTaskForm({ subject_id: Number(f.subject) || state.subjects[0].id }, refresh);
  };

  const bind = (id, key, isCheck = false) => {
    const el = document.getElementById(id);
    el[isCheck ? 'onchange' : 'oninput'] = () => {
      state.filters[key] = isCheck ? el.checked : el.value;
      state.refocus = isCheck ? null : id;
      renderView();
    };
  };
  bind('f-q', 'q');
  bind('f-subject', 'subject', true);
  bind('f-status', 'status', true);
  bind('f-assignee', 'assignee', true);
  bind('f-done', 'showDone', true);

  bindTaskRows(view, state.tasks, refresh);

  // Repintar a lista a cada tecla nao pode custar o foco do campo de busca.
  if (state.refocus) {
    const el = document.getElementById(state.refocus);
    if (el) {
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    }
  }
}

/* ------------------------------------------------------------ agenda */

function viewAgenda(view) {
  const classesByDay = new Map();
  for (const s of state.subjects) {
    for (const c of s.classes) {
      if (!classesByDay.has(c.weekday)) classesByDay.set(c.weekday, []);
      classesByDay.get(c.weekday).push({ ...c, subject: s });
    }
  }
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => (d >= 1 && d <= 5) || classesByDay.has(d));
  const today = new Date().getDay();

  const upcoming = state.tasks
    .filter((t) => t.status !== 'concluida' && t.due_date)
    .slice(0, 12);

  view.innerHTML = `
    <div class="page-head"><div><h2>Agenda</h2><p>Aulas da semana e próximos prazos.</p></div></div>
    <div class="week">
      ${days.map((d) => {
        const list = (classesByDay.get(d) ?? []).sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''));
        return `<div class="week-day${d === today ? ' today' : ''}">
          <h4>${esc(WEEKDAYS[d])}</h4>
          ${list.length ? list.map((c) => `
            <div class="class-block" data-subject="${c.subject.id}" style="--card-color:${esc(c.subject.color)}">
              ${c.starts_at ? `<div class="time">${esc(c.starts_at)}${c.ends_at ? ` - ${esc(c.ends_at)}` : ''}</div>` : ''}
              <div class="name">${esc(c.subject.name)}</div>
              ${c.room ? `<div class="time">Sala ${esc(c.room)}</div>` : ''}
            </div>`).join('')
            : '<div style="color:var(--muted);font-size:12.5px">Sem aulas</div>'}
        </div>`;
      }).join('')}
    </div>
    <h3 style="margin:28px 0 12px">Próximos prazos</h3>
    ${upcoming.length
      ? `<div class="list">${upcoming.map((t) => taskRow(t, true)).join('')}</div>`
      : '<div class="empty">Nenhum prazo em aberto.</div>'}`;

  view.querySelectorAll('.class-block').forEach((b) => {
    b.onclick = () => openSubjectModal(Number(b.dataset.subject), 'dates');
  });
  bindTaskRows(view, state.tasks, refresh);
}

/* ------------------------------------------------------------ equipe */

/** Funcoes nas tarefas (Responsável, Conferente...). Gerenciar e so do admin. */
function taskRolesSection() {
  const roles = state.taskRoles;
  return `
    <section class="home-section">
      <div class="section-head">
        <div><h3>Funções nas tarefas</h3><p class="section-sub">O papel de cada pessoa numa tarefa: quem faz, quem confere, quem envia. Qualquer membro pode criar uma nova ao montar uma tarefa.</p></div>
        <button class="btn" data-act="new-task-role">+ Nova função</button>
      </div>
      ${roles.length ? `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Função</th><th>Em uso</th><th></th></tr></thead>
          <tbody>
            ${roles.map((r) => `<tr>
              <td><strong>${esc(r.name)}</strong></td>
              <td>${r.uses ? plural(r.uses, 'atribuição', 'atribuições') : '<span class="muted-text">Ainda não usada</span>'}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn-sm" data-act="edit-task-role" data-id="${r.id}">Renomear</button>
                <button class="btn btn-sm btn-danger" data-act="del-task-role" data-id="${r.id}">Excluir</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`
        : '<div class="empty"><strong>Nenhuma função ainda</strong>Crie funções como Responsável, Conferente ou Quem envia.</div>'}
    </section>`;
}

function bindTaskRolesSection(view) {
  view.querySelector('[data-act="new-task-role"]').onclick = () => openTaskRoleForm(null, refresh);
  view.querySelectorAll('[data-act="edit-task-role"]').forEach((b) => {
    b.onclick = () => openTaskRoleForm(state.taskRoles.find((r) => r.id === Number(b.dataset.id)), refresh);
  });
  view.querySelectorAll('[data-act="del-task-role"]').forEach((b) => {
    b.onclick = async () => {
      const role = state.taskRoles.find((r) => r.id === Number(b.dataset.id));
      const ok = await confirmDialog({
        title: `Excluir a função ${role.name}?`,
        message: role.uses
          ? 'As pessoas continuam nas tarefas, só que sem essa função.'
          : 'Nenhuma tarefa usa essa função.',
        confirmText: 'Excluir função',
      });
      if (!ok) return;
      try { await api.deleteTaskRole(role.id); toast('Função excluída.'); await refresh(); }
      catch (err) { toast(err.message, 'error'); }
    };
  });
}

/** Convites que ainda nao viraram conta. So aparece para admin. */
function invitesSection() {
  const data = state.invites;
  if (!data) return '';
  const pending = data.invites;
  const setup = !data.mail_enabled
    ? 'Envio por e-mail desligado: o link aparece para você copiar. Configure SMTP no .env para enviar sozinho.'
    : '';
  return `
    <section class="home-section">
      <div class="section-head">
        <div><h3>Convites pendentes</h3><p class="section-sub">${pending.length
          ? 'Quem ainda não abriu o link. Reenviar gera um link novo e invalida o anterior.'
          : 'Nenhum convite esperando resposta.'}${setup ? ` ${esc(setup)}` : ''}</p></div>
      </div>
      ${pending.length ? `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>E-mail</th><th>Cargo</th><th>Perfil</th><th>Convidado por</th><th>Validade</th><th></th></tr></thead>
          <tbody>
            ${pending.map((i) => `<tr>
              <td><strong>${esc(i.email)}</strong></td>
              <td>${i.position_name ? esc(i.position_name) : '<span class="muted-text">--</span>'}</td>
              <td>${esc(i.profile_name || 'Membro')}</td>
              <td>${esc(i.invited_by_name || '--')}</td>
              <td>${i.expired ? '<span class="pill alert">Expirado</span>'
                : `<span class="pill muted">até ${esc(formatDate(i.expires_at.slice(0, 10)))}</span>`}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn-sm" data-act="resend-invite" data-id="${i.id}">Reenviar</button>
                <button class="btn btn-sm btn-danger" data-act="cancel-invite" data-id="${i.id}">Cancelar</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : ''}
    </section>`;
}

function viewTeam(view) {
  const canUsers = can('equipe.gerenciar');
  const canInvite = can('equipe.convidar');
  const canRoles = can('equipe.cargos');
  // Quem gerencia contas ve a lista completa (tarefas abertas, quem pode editar).
  const people = canUsers ? state.users : state.team;

  view.innerHTML = `
    <div class="page-head">
      <div><h2>Equipe</h2><p>${canUsers
        ? 'Cadastre as contas e defina o perfil e o cargo de cada integrante.'
        : 'Pessoas da turma, o perfil e o cargo de cada uma.'}</p></div>
      <div class="spacer"></div>
      ${canUsers ? '<button class="btn" data-act="new-user" title="Cria a conta na hora, com senha definida por você">+ Adicionar pessoa</button>' : ''}
      ${canInvite ? '<button class="btn btn-primary" data-act="invite">Convidar participante</button>' : ''}
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <th>Pessoa</th><th>Perfil</th><th>Cargo</th><th>E-mail</th>
        ${canUsers ? '<th>Tarefas abertas</th><th></th>' : ''}
      </tr></thead>
      <tbody>
        ${people.map((u) => `<tr>
          <td><div class="member-cell">${avatar(u)}<strong>${esc(u.name)}</strong>
            ${u.id === state.user.id ? '<span class="pill muted">você</span>' : ''}</div></td>
          <td>${profilePill(u)}</td>
          <td>${u.position_name ? `<span class="pill">${esc(u.position_name)}</span>` : '<span class="muted-text">--</span>'}</td>
          <td>${esc(u.email)}</td>
          ${canUsers ? `<td>${u.open_tasks ?? 0}</td>
            <td style="text-align:right;white-space:nowrap">
              ${u.manageable ? `
                <button class="btn btn-sm" data-act="edit-user" data-id="${u.id}">Editar</button>
                <button class="btn btn-sm btn-danger" data-act="del-user" data-id="${u.id}">Remover</button>`
                : `<span class="hint" title="Só dá para gerenciar quem está abaixo de você na hierarquia">${u.id === state.user.id ? 'Seus dados: menu da conta' : 'Acima ou no seu nível'}</span>`}
            </td>` : ''}
        </tr>`).join('')}
      </tbody>
    </table></div>

    ${state.semesterId ? `
      <section class="home-section">
        <div class="section-head">
          <div><h3>Entregas por integrante</h3><p class="section-sub">Carga de cada pessoa no semestre selecionado. Clique para ver as tarefas.</p></div>
        </div>
        ${teamTable()}
      </section>` : ''}

    ${canInvite ? invitesSection() : ''}

    ${canRoles ? `
      <section class="home-section">
        <div class="section-head">
          <div><h3>Cargos</h3><p class="section-sub">Rótulos da equipe (Líder, Revisor...). O que cada pessoa pode fazer vem do perfil, não do cargo.</p></div>
          <button class="btn" data-act="new-position">+ Novo cargo</button>
        </div>
        ${state.positions.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Cargo</th><th>Integrantes</th><th></th></tr></thead>
            <tbody>
              ${state.positions.map((p) => `<tr>
                <td><strong>${esc(p.name)}</strong></td>
                <td>${p.members ? esc(state.team.filter((u) => u.position_id === p.id).map((u) => u.name).join(', ')) : '<span class="muted-text">Ninguém ainda</span>'}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn-sm" data-act="edit-position" data-id="${p.id}">Renomear</button>
                  <button class="btn btn-sm btn-danger" data-act="del-position" data-id="${p.id}">Excluir</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
          : '<div class="empty"><strong>Nenhum cargo ainda</strong>Crie cargos e escolha um para cada pessoa em Editar.</div>'}
      </section>
      ${taskRolesSection()}` : ''}`;

  view.querySelector('[data-act="new-user"]')?.addEventListener('click', () => openUserForm(null, refresh));
  bindMemberRows(view);
  view.querySelector('[data-act="invite"]')?.addEventListener('click', () => openInviteForm(refresh));

  view.querySelectorAll('[data-act="edit-user"]').forEach((b) => {
    b.onclick = () => openUserForm(state.users.find((u) => u.id === Number(b.dataset.id)), refresh);
  });
  view.querySelectorAll('[data-act="del-user"]').forEach((b) => {
    b.onclick = async () => {
      const user = state.users.find((u) => u.id === Number(b.dataset.id));
      const ok = await confirmDialog({
        title: `Remover ${user.name}?`,
        message: 'A pessoa perde o acesso. As tarefas continuam, mas sem essa pessoa como responsável.',
        confirmText: 'Remover',
      });
      if (!ok) return;
      try { await api.deleteUser(user.id); toast('Pessoa removida.'); await refresh(); }
      catch (err) { toast(err.message, 'error'); }
    };
  });

  view.querySelectorAll('[data-act="resend-invite"]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { showInviteResult(await api.resendInvite(Number(b.dataset.id))); await refresh(); }
      catch (err) { toast(err.message, 'error'); b.disabled = false; }
    };
  });
  view.querySelectorAll('[data-act="cancel-invite"]').forEach((b) => {
    b.onclick = async () => {
      const invite = state.invites.invites.find((i) => i.id === Number(b.dataset.id));
      const ok = await confirmDialog({
        title: `Cancelar o convite de ${invite.email}?`,
        message: 'O link enviado deixa de funcionar.',
        confirmText: 'Cancelar convite',
      });
      if (!ok) return;
      try { await api.cancelInvite(invite.id); toast('Convite cancelado.'); await refresh(); }
      catch (err) { toast(err.message, 'error'); }
    };
  });

  if (!canRoles) return;
  view.querySelector('[data-act="new-position"]').onclick = () => openPositionForm(null, refresh);
  bindTaskRolesSection(view);
  view.querySelectorAll('[data-act="edit-position"]').forEach((b) => {
    b.onclick = () => openPositionForm(state.positions.find((p) => p.id === Number(b.dataset.id)), refresh);
  });
  view.querySelectorAll('[data-act="del-position"]').forEach((b) => {
    b.onclick = async () => {
      const position = state.positions.find((p) => p.id === Number(b.dataset.id));
      const ok = await confirmDialog({
        title: `Excluir o cargo ${position.name}?`,
        message: position.members
          ? `${position.members === 1 ? '1 pessoa fica' : `${position.members} pessoas ficam`} sem cargo. As contas não mudam.`
          : 'Ninguém tem esse cargo.',
        confirmText: 'Excluir cargo',
      });
      if (!ok) return;
      try { await api.deletePosition(position.id); toast('Cargo excluído.'); await refresh(); }
      catch (err) { toast(err.message, 'error'); }
    };
  });
}

/** Etiqueta do perfil; o Administrador vem destacado. */
function profilePill(u) {
  const name = u.profile_name || 'Sem perfil';
  return `<span class="pill ${u.profile_key === 'admin' ? 'strong' : 'muted'}">${esc(name)}</span>`;
}

/* ------------------------------------------------------------ perfis e acesso */

function viewProfiles(view) {
  const { profiles, groups } = state.profiles;
  const manage = can('perfis.gerenciar');
  const people = (p) => state.team.filter((u) => u.profile_id === p.id);

  view.innerHTML = `
    <div class="page-head">
      <div><h2>Perfis e acesso</h2><p>Quem pode fazer o quê e quem manda em quem.</p></div>
      <div class="spacer"></div>
      ${manage ? '<button class="btn btn-primary" data-act="new-profile">+ Novo perfil</button>' : ''}
    </div>

    <div class="rules">
      <div><strong>Hierarquia por nível.</strong> Quanto menor o número, mais alto o perfil. O Administrador fica no topo (nível 0).</div>
      <div><strong>Cada um gerencia quem está abaixo.</strong> Cada pessoa só edita, remove ou convida quem tem nível maior que o dela, e só concede perfis abaixo do seu.</div>
      <div><strong>Ninguém dá o que não tem.</strong> Um perfil só pode receber direitos que quem o edita também tem. Ninguém muda o próprio perfil.</div>
      <div><strong>Sempre existe um Administrador.</strong> Esse perfil tem todos os direitos, não pode ser alterado nem excluído, e o app não deixa rebaixar o último.</div>
    </div>

    <section class="home-section">
      <div class="section-head"><div><h3>Hierarquia</h3><p class="section-sub">Do nível mais alto para o mais baixo. Seu perfil: <strong>${esc(state.user.profile_name)}</strong>.</p></div></div>
      <div class="ladder">
        ${profiles.map((p) => {
          const members = people(p);
          return `
          <div class="ladder-step${p.id === state.user.profile_id ? ' mine' : ''}">
            <div class="ladder-level" title="Nível ${p.level}">${p.level}</div>
            <div class="ladder-body">
              <div class="ladder-title">
                <strong>${esc(p.name)}</strong>
                ${p.key === 'admin' ? '<span class="pill strong">Topo · todos os direitos</span>' : ''}
                ${p.key === 'member' ? '<span class="pill muted">Padrão de quem entra</span>' : ''}
                ${p.id === state.user.profile_id ? '<span class="pill muted">seu perfil</span>' : ''}
              </div>
              <div class="ladder-meta">
                ${p.permissions.length} de ${groups.flatMap((g) => g.items).length} direitos ·
                ${members.length ? esc(members.map((u) => u.name.split(' ')[0]).join(', ')) : 'ninguém'}
                ${p.pending_invites ? ` · ${plural(p.pending_invites, 'convite pendente', 'convites pendentes')}` : ''}
              </div>
            </div>
            <div class="ladder-actions">
              ${p.editable ? `
                <button class="btn btn-sm" data-act="edit-profile" data-id="${p.id}">Editar</button>
                ${p.is_system ? '' : `<button class="btn btn-sm btn-danger" data-act="del-profile" data-id="${p.id}">Excluir</button>`}`
                : `<button class="btn btn-sm btn-ghost" data-act="view-profile" data-id="${p.id}">Ver direitos</button>`}
            </div>
          </div>`;
        }).join('')}
      </div>
    </section>

    <section class="home-section">
      <div class="section-head"><div><h3>Direitos por perfil</h3><p class="section-sub">Visão geral. Para mudar, use Editar no perfil. Editar e excluir o que a própria pessoa criou é sempre permitido.</p></div></div>
      <div class="table-wrap"><table class="table matrix">
        <thead><tr><th>Direito</th>${profiles.map((p) => `<th class="c">${esc(p.name)}</th>`).join('')}</tr></thead>
        <tbody>
          ${groups.map((g) => `
            <tr class="matrix-group"><td colspan="${profiles.length + 1}">${esc(g.label)}</td></tr>
            ${g.items.map((item) => `<tr>
              <td>${esc(item.label)}</td>
              ${profiles.map((p) => `<td class="c">${p.permissions.includes(item.key)
                ? '<span class="yes" title="Tem">&#10003;</span>'
                : '<span class="no" title="Não tem">—</span>'}</td>`).join('')}
            </tr>`).join('')}`).join('')}
        </tbody>
      </table></div>
    </section>`;

  const find = (b) => profiles.find((p) => p.id === Number(b.dataset.id));
  view.querySelector('[data-act="new-profile"]')?.addEventListener('click', () => openProfileEditor(null, refresh));
  view.querySelectorAll('[data-act="edit-profile"]').forEach((b) => { b.onclick = () => openProfileEditor(find(b), refresh); });
  view.querySelectorAll('[data-act="view-profile"]').forEach((b) => { b.onclick = () => openProfileEditor(find(b), refresh, { readOnly: true }); });
  view.querySelectorAll('[data-act="del-profile"]').forEach((b) => {
    b.onclick = async () => {
      const profile = find(b);
      const ok = await confirmDialog({
        title: `Excluir o perfil ${profile.name}?`,
        message: profile.members
          ? `${profile.members === 1 ? '1 pessoa usa' : `${profile.members} pessoas usam`} esse perfil: mude-as para outro antes de excluir.`
          : 'Ninguém usa esse perfil.',
        confirmText: 'Excluir perfil',
      });
      if (!ok) return;
      try { await api.deleteProfile(profile.id); toast('Perfil excluído.'); await refresh(); }
      catch (err) { toast(err.message, 'error'); }
    };
  });
}

boot();
