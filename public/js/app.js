import { api } from './api.js';
import { STATUSES, WEEKDAYS, avatar, confirmDialog, daysUntil, dueLabel, esc, formatDate, toast } from './ui.js';
import {
  bindTaskRows, initModals, openInviteForm, openPasswordForm, openPositionForm, openProfileForm, openSemesterForm, openTaskRoleForm,
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
  invites: null, // { mail_enabled, base_is_local, invites: [...] } — so admin
  overview: null,
  view: localStorage.getItem('view') || 'inicio',
  filters: { subject: '', status: '', assignee: '', q: '', showDone: false },
};

initModals({ state, reload: refresh });

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
  if (state.user.role === 'admin') {
    [state.users, state.invites] = await Promise.all([
      api.users().catch(() => []),
      api.invites().catch(() => null),
    ]);
  }
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
      toast(`Bem-vindo(a), ${user.name.split(' ')[0]}!`);
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
      <h2>Você foi convidado(a)</h2>
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
      toast(`Bem-vindo(a), ${user.name.split(' ')[0]}!`);
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
          <span class="role">${state.user.role === 'admin' ? 'Admin' : 'Membro'}</span></span>
          <span class="chevron" aria-hidden="true">&#9662;</span>
        </button>
        <div class="menu" id="user-menu" role="menu" hidden>
          <div class="menu-head">
            <strong>${esc(state.user.name)}</strong>
            <span>${esc(state.user.email)}</span>
          </div>
          <button class="menu-item" role="menuitem" data-menu="profile">Editar perfil</button>
          <button class="menu-item" role="menuitem" data-menu="password">Alterar senha</button>
          ${state.user.role === 'admin'
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
        <button class="nav-item" id="quick-subject">+ Nova matéria</button>
        <button class="nav-item" id="quick-task">+ Nova tarefa</button>
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
  document.getElementById('quick-subject').onclick = () => requireSemester(() => openSubjectForm(null, refresh));
  document.getElementById('quick-task').onclick = () => requireSemester(() => {
    if (!state.subjects.length) return toast('Cadastre uma matéria antes de criar tarefas.', 'error');
    openTaskForm({ subject_id: state.subjects[0].id }, refresh);
  });

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
    inicio: viewHome, materias: viewSubjects, tarefas: viewTasks, agenda: viewAgenda, equipe: viewTeam,
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
      <button class="btn btn-sm" id="semester-edit" title="Editar semestre"${state.semesterId ? '' : ' disabled'}>Editar</button>
      <button class="btn btn-sm" id="semester-new" title="Novo semestre">+ Novo</button>
    </div>`;
}

function bindSemesterPicker(view) {
  view.querySelector('#semester-select').onchange = async (e) => {
    state.semesterId = Number(e.target.value) || null;
    localStorage.setItem('semesterId', state.semesterId ?? '');
    await refresh();
  };
  view.querySelector('#semester-new').onclick = () => openSemesterForm(null, onSemesterSaved);
  view.querySelector('#semester-edit').onclick = () => {
    const semester = state.semesters.find((s) => s.id === state.semesterId);
    if (semester) openSemesterForm(semester, onSemesterSaved);
  };
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
    ${unassigned ? `<p class="hint table-note">${unassigned} tarefa(s) aberta(s) sem responsável.</p>` : ''}`;
}

function viewHome(view) {
  const semester = state.semesters.find((s) => s.id === state.semesterId);
  const o = state.overview ?? {};
  const period = semester?.starts_on || semester?.ends_on
    ? ` · ${[semester.starts_on, semester.ends_on].map((d) => formatDate(d, { year: 'numeric' }) || '?').join(' a ')}`
    : '';

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Visão geral</h2>
        <p>${semester ? `Semestre ${esc(semester.name)}${esc(period)}` : 'Comece criando um semestre.'}</p>
      </div>
      <div class="spacer"></div>
      ${semesterPicker()}
    </div>
    ${!semester ? noSemester() : `
      <div class="stats">
        <div class="stat"><div class="value">${o.subjects ?? 0}</div><div class="label">Matérias</div></div>
        <div class="stat"><div class="value">${o.open_tasks ?? 0}</div><div class="label">Tarefas abertas</div></div>
        <div class="stat${o.late_tasks ? ' alert' : ''}"><div class="value">${o.late_tasks ?? 0}</div><div class="label">Atrasadas</div></div>
        <div class="stat"><div class="value">${o.week_tasks ?? 0}</div><div class="label">Vencem em 7 dias</div></div>
      </div>

      <section class="home-section">
        <div class="section-head">
          <div><h3>Integrantes</h3><p class="section-sub">Entregas de cada pessoa neste semestre. Clique para ver as tarefas.</p></div>
        </div>
        ${teamTable()}
      </section>

      <section class="home-section">
        <div class="section-head">
          <div><h3>Matérias</h3><p class="section-sub">${state.subjects.length} matéria(s) em ${esc(semester.name)}. Clique para abrir.</p></div>
          <button class="btn btn-primary" data-act="new-subject">+ Nova matéria</button>
        </div>
        ${subjectTable()}
      </section>`}`;

  bindSemesterPicker(view);
  bindSubjects(view);
  view.querySelectorAll('[data-member]').forEach((row) => {
    const open = () => {
      Object.assign(state.filters, { assignee: row.dataset.member, subject: '', status: '', q: '', showDone: false });
      goTo('tarefas');
    };
    row.onclick = open;
    row.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
}

/* ------------------------------------------------------------ materias */

const noSemester = () => `
  <div class="empty">
    <strong>Comece criando um semestre</strong>
    Ex.: 2026.1. Depois, cadastre as matérias, os professores, os dias de aula e as tarefas.
    <div style="margin-top:14px"><button class="btn btn-primary" id="first-semester">Criar semestre</button></div>
  </div>`;

/** Dias de aula sem repeticao, abreviados: "Seg · Qua". */
const classDays = (s) => s.classes
  .map((c) => WEEKDAYS[c.weekday].slice(0, 3))
  .filter((v, i, a) => a.indexOf(v) === i);

/** Lista compacta da Visao geral: uma linha por materia, colunas alinhadas. */
function subjectTable() {
  if (!state.subjects.length) {
    return `<div class="empty"><strong>Nenhuma matéria neste semestre</strong>Cadastre a primeira em + Nova matéria.</div>`;
  }
  return `
    <div class="table-wrap"><table class="table wide">
      <thead><tr>
        <th>Matéria</th><th>Professor</th><th>Aulas</th><th class="c">Tarefas abertas</th><th>Próximo prazo</th><th></th>
      </tr></thead>
      <tbody>
        ${state.subjects.map((s) => {
          const due = dueLabel(s.next_due);
          const days = classDays(s);
          return `<tr class="row-link" data-subject="${s.id}" tabindex="0" title="Abrir ${esc(s.name)}">
            <td><div class="member-cell">
              <span class="subject-dot" style="width:10px;height:10px;background:${esc(s.color)}"></span>
              <div class="subject-name"><strong>${esc(s.name)}</strong>${s.code ? `<span class="mono muted-text">${esc(s.code)}</span>` : ''}</div>
            </div></td>
            <td>${s.professor ? esc(s.professor) : '<span class="muted-text">--</span>'}</td>
            <td>${days.length ? esc(days.join(' · ')) : '<span class="muted-text">--</span>'}</td>
            <td class="c">${s.open_tasks ? `<span class="num">${s.open_tasks}</span>` : '<span class="num zero">0</span>'}</td>
            <td>${due ? `<span class="pill ${due.tone}">${esc(due.text)}</span>` : '<span class="muted-text">Em dia</span>'}</td>
            <td style="text-align:right"><button class="btn btn-sm" data-edit-subject="${s.id}">Editar</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
}

/** Aba Materias: os cartoes, com a imagem de capa de cada materia. */
function viewSubjects(view) {
  const semester = state.semesters.find((s) => s.id === state.semesterId);
  view.innerHTML = `
    <div class="page-head">
      <div>
        <h2>Matérias</h2>
        <p>${semester ? `${state.subjects.length} matéria(s) em ${esc(semester.name)}` : 'Comece criando um semestre.'}</p>
      </div>
      <div class="spacer"></div>
      ${semesterPicker()}
    </div>
    ${!semester ? noSemester() : `
      <div class="grid">
        ${state.subjects.map(subjectCard).join('')}
        <button class="add-card" data-act="new-subject"><span style="font-size:22px">+</span>Nova matéria</button>
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
      ? `<span class="pill strong">${s.open_tasks} tarefa(s)</span>`
      : '<span class="pill muted">Em dia</span>',
    s.note_count ? `<span class="pill muted">${s.note_count} resumo(s)</span>` : null,
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
      <button class="btn btn-sm card-edit" data-edit-subject="${s.id}" title="Editar ${esc(s.name)}">Editar</button>
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
      <div><h2>Tarefas</h2><p>${visible.length} de ${state.tasks.length} tarefa(s)</p></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" data-act="new-task">+ Nova tarefa</button>
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

  view.querySelector('[data-act="new-task"]').onclick = () => {
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
    <div class="page-head"><div><h2>Agenda</h2><p>Aulas da semana e próximos prazos</p></div></div>
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
              <td>${r.uses ? `${r.uses} atribuição(ões)` : '<span class="muted-text">Ainda não usada</span>'}</td>
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
              <td>${i.role === 'admin' ? 'Administrador' : 'Membro'}</td>
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
  const isAdmin = state.user.role === 'admin';
  const people = isAdmin ? state.users : state.team;

  view.innerHTML = `
    <div class="page-head">
      <div><h2>Equipe</h2><p>${isAdmin
        ? 'Cadastre as contas, crie cargos e atribua um cargo a cada integrante.'
        : 'Pessoas da turma e o cargo de cada uma.'}</p></div>
      <div class="spacer"></div>
      ${isAdmin ? `
        <button class="btn" data-act="new-user" title="Cria a conta na hora, com senha definida por você">+ Adicionar pessoa</button>
        <button class="btn btn-primary" data-act="invite">Convidar participante</button>` : ''}
    </div>
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <th>Pessoa</th><th>Cargo</th><th>E-mail</th><th>Perfil</th>
        ${isAdmin ? '<th>Tarefas abertas</th><th></th>' : ''}
      </tr></thead>
      <tbody>
        ${people.map((u) => `<tr>
          <td><div class="member-cell">${avatar(u)}<strong>${esc(u.name)}</strong>
            ${u.id === state.user.id ? '<span class="pill muted">você</span>' : ''}</div></td>
          <td>${u.position_name ? `<span class="pill">${esc(u.position_name)}</span>` : '<span class="muted-text">--</span>'}</td>
          <td>${esc(u.email)}</td>
          <td><span class="pill ${u.role === 'admin' ? 'strong' : 'muted'}">${u.role === 'admin' ? 'Administrador' : 'Membro'}</span></td>
          ${isAdmin ? `<td>${u.open_tasks ?? 0}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn btn-sm" data-act="edit-user" data-id="${u.id}">Editar</button>
              ${u.id === state.user.id ? '' : `<button class="btn btn-sm btn-danger" data-act="del-user" data-id="${u.id}">Remover</button>`}
            </td>` : ''}
        </tr>`).join('')}
      </tbody>
    </table></div>

    ${isAdmin ? invitesSection() : ''}

    ${isAdmin ? `
      <section class="home-section">
        <div class="section-head">
          <div><h3>Cargos</h3><p class="section-sub">Rótulos da equipe (Líder, Revisor...). As permissões continuam vindo do perfil.</p></div>
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
      </section>` : ''}

    ${isAdmin ? taskRolesSection() : ''}`;

  if (!isAdmin) return;
  view.querySelector('[data-act="invite"]').onclick = () => openInviteForm(refresh);
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
          ? `${position.members} pessoa(s) ficam sem cargo. As contas não mudam.`
          : 'Ninguém tem esse cargo.',
        confirmText: 'Excluir cargo',
      });
      if (!ok) return;
      try { await api.deletePosition(position.id); toast('Cargo excluído.'); await refresh(); }
      catch (err) { toast(err.message, 'error'); }
    };
  });
  view.querySelector('[data-act="new-user"]').onclick = () => openUserForm(null, refresh);
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
}

boot();
