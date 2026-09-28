import { api } from './api.js';
import { aiPanelHtml, bindAiPanel } from './ai-panel.js';
import {
  KINDS, PALETTE, PRIORITIES, STATUSES, WEEKDAYS, WEEKDAYS_SHORT,
  avatar, confirmDialog, dueLabel, esc, formatDate, openModal, setModalBackdrop, showFormError, toast, withBusy,
} from './ui.js';

/** Contexto injetado pelo app.js (evita import circular). */
let ctx = { state: null, reload: async () => {} };
export function initModals(next) { ctx = next; }

const me = () => ctx.state.user;
const canManage = (record) => me()?.role === 'admin' || record?.created_by === me()?.id;

const field = (label, inner, hint = '') =>
  `<div class="field"><label>${esc(label)}</label>${inner}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`;

const options = (map, selected) => Object.entries(map)
  .map(([v, l]) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(l)}</option>`)
  .join('');

const colorPicker = (value) => `
  <div class="swatches">
    <input type="color" name="color" value="${esc(value || PALETTE[0])}">
    ${PALETTE.map((c) => `<button type="button" class="swatch" data-color="${c}" title="${c}"
        style="background:${c}"></button>`).join('')}
  </div>`;

function bindSwatches(root) {
  const input = root.querySelector('input[name="color"]');
  root.querySelectorAll('.swatch').forEach((b) => {
    b.onclick = () => { input.value = b.dataset.color; };
  });
}

const val = (root, name) => root.querySelector(`[name="${name}"]`)?.value.trim() ?? '';

/* ======================================================= modal da materia */

export async function openSubjectModal(subjectId, initialTab = 'info') {
  let subject;
  try {
    subject = await api.subject(subjectId);
  } catch (err) {
    return toast(err.message, 'error');
  }

  let tab = initialTab;

  return openModal({
    html: `
      <div class="modal-head">
        <span class="subject-dot" data-slot="dot" style="width:12px;height:12px;background:${esc(subject.color)}"></span>
        <div>
          <h3 data-slot="title">${esc(subject.name)}</h3>
          <p data-slot="subtitle"></p>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-act="edit-subject" title="Editar informações da matéria">Editar</button>
        <button class="btn btn-ghost btn-sm" data-close title="Fechar">&times;</button>
      </div>
      <div class="tabs">
        <button class="tab" data-tab="info">Informações</button>
        <button class="tab" data-tab="tasks">Tarefas</button>
        <button class="tab" data-tab="notes">Resumos</button>
        <button class="tab" data-tab="dates">Datas</button>
      </div>
      <div class="modal-body" data-slot="body"></div>`,
    onMount(root, close) {
      const body = root.querySelector('[data-slot="body"]');

      const paint = () => {
        // Tudo dentro do modal brilha na cor desta materia.
        root.style.setProperty('--row-color', subject.color);
        // Fundo escolhido para a materia aparece atras do modal (volta ao veu se removido).
        setModalBackdrop(root, api.subjectImageUrl(subject, 'backdrop'));
        root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        root.querySelector('[data-slot="dot"]').style.background = subject.color;
        root.querySelector('[data-slot="title"]').textContent = subject.name;
        root.querySelector('[data-slot="subtitle"]').textContent = [
          subject.code, subject.professor, `${subject.tasks.filter((t) => t.status !== 'concluida').length} tarefa(s) aberta(s)`,
        ].filter(Boolean).join(' · ');
        body.innerHTML = TAB_RENDERERS[tab](subject);
        TAB_BINDERS[tab]?.(body, subject, reload, close);
      };

      const reload = async () => {
        subject = await api.subject(subjectId);
        paint();
        ctx.reload();
      };

      root.querySelectorAll('.tab').forEach((b) => {
        b.onclick = () => { tab = b.dataset.tab; paint(); };
      });
      root.querySelector('[data-act="edit-subject"]').onclick = () => openSubjectForm(subject, reload);
      paint();
    },
  });
}

const TAB_RENDERERS = {
  info: (s) => {
    const item = (k, v) => `<div class="info-item"><div class="k">${esc(k)}</div><div class="v">${v || '<span class="muted-text">--</span>'}</div></div>`;
    return `
      <div class="info-grid">
        ${item('Professor', esc(s.professor))}
        ${item('Contato', s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : '')}
        ${item('Código', esc(s.code))}
        ${item('Sala', esc(s.room))}
        ${item('Aulas', s.classes.length
          ? s.classes.map((c) => `${WEEKDAYS_SHORT[c.weekday]}${c.starts_at ? ` ${esc(c.starts_at)}` : ''}`).join(' · ')
          : '')}
        ${item('Criada por', esc(s.created_by_name))}
      </div>
      ${s.observations ? `<div class="info-block">
        <div class="info-item"><div class="k">Observações</div></div>
        <div class="info-text">${esc(s.observations)}</div></div>` : ''}
      <div class="action-row">
        <button class="btn" data-act="edit">Editar matéria</button>
        <button class="btn" data-act="new-task">Nova tarefa</button>
        <button class="btn" data-act="new-note">Novo resumo</button>
        <div class="spacer"></div>
        ${canManage(s) ? '<button class="btn btn-danger" data-act="delete">Excluir</button>' : ''}
      </div>`;
  },

  tasks: (s) => `
    <div class="section-head">
      <strong>${s.tasks.length} tarefa(s)</strong>
      <button class="btn btn-primary btn-sm" data-act="new-task">+ Nova tarefa</button>
    </div>
    ${s.tasks.length ? `<div class="list">${s.tasks.map(taskRow).join('')}</div>`
      : '<div class="empty"><strong>Nenhuma tarefa ainda</strong>Cadastre a primeira com prazo e responsáveis.</div>'}`,

  notes: (s) => `
    <div class="section-head">
      <strong>${s.notes.length} resumo(s)</strong>
      <button class="btn btn-primary btn-sm" data-act="new-note">+ Novo resumo</button>
    </div>
    ${aiPanelHtml()}
    ${s.notes.length ? s.notes.map((n) => `
      <div class="note-card" data-note="${n.id}">
        <h4>${esc(n.title)}</h4>
        <div class="note-meta">${esc(n.created_by_name || 'Equipe')} · atualizado em ${esc(formatDate(n.updated_at, { year: 'numeric' }) || n.updated_at.slice(0, 10))}</div>
        <div class="note-body">${esc(n.content) || '<span class="muted-text">Sem conteúdo.</span>'}</div>
        <div class="note-actions">
          <button class="btn btn-sm" data-act="toggle-note" hidden>Ver mais</button>
          ${canManage(n) ? `
            <button class="btn btn-sm" data-act="edit-note" data-id="${n.id}">Editar</button>
            <button class="btn btn-sm btn-danger" data-act="del-note" data-id="${n.id}">Excluir</button>` : ''}
        </div>
      </div>`).join('')
      : '<div class="empty"><strong>Nenhum resumo ainda</strong>Guarde aqui o conteúdo estudado, links e anotações da aula.</div>'}`,

  dates: (s) => {
    const dated = s.tasks.filter((t) => t.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    return `
      <h4 class="section-title">Aulas da semana</h4>
      ${s.classes.length ? `<div class="list section-gap">${s.classes.map((c) => `
        <div class="task"><div class="task-body">
          <div class="task-title">${esc(WEEKDAYS[c.weekday])}</div>
          <div class="task-desc">${c.room ? `Sala ${esc(c.room)}` : ''}</div>
          <div class="task-meta">
            <span class="pill muted">${c.starts_at
              ? `${esc(c.starts_at)}${c.ends_at ? ` - ${esc(c.ends_at)}` : ''}`
              : 'Horário a definir'}</span>
          </div>
        </div></div>`).join('')}</div>`
        : '<div class="empty section-gap">Nenhum dia de aula cadastrado. Edite a matéria para incluir.</div>'}

      <h4 class="section-title">Prazos</h4>
      ${dated.length ? `<div class="list">${dated.map(taskRow).join('')}</div>`
        : '<div class="empty">Nenhuma data marcada.</div>'}`;
  },
};

const TAB_BINDERS = {
  info: (body, subject, reload, close) => {
    body.querySelector('[data-act="edit"]').onclick = () => openSubjectForm(subject, reload);
    body.querySelector('[data-act="new-task"]').onclick = () => openTaskForm({ subject_id: subject.id }, reload);
    body.querySelector('[data-act="new-note"]').onclick = () => openNoteForm({ subject_id: subject.id }, reload);
    const del = body.querySelector('[data-act="delete"]');
    if (del) {
      del.onclick = async () => {
        const ok = await confirmDialog({
          title: `Excluir ${subject.name}?`,
          message: 'Tarefas, resumos e aulas desta matéria serão removidos junto. Não é possível desfazer.',
          confirmText: 'Excluir matéria',
        });
        if (!ok) return;
        try {
          await api.deleteSubject(subject.id);
          toast('Matéria excluída.');
          close();
          ctx.reload();
        } catch (err) { toast(err.message, 'error'); }
      };
    }
  },

  tasks: (body, subject, reload) => {
    body.querySelector('[data-act="new-task"]').onclick = () => openTaskForm({ subject_id: subject.id }, reload);
    bindTaskRows(body, subject.tasks, reload);
  },

  notes: (body, subject, reload) => {
    body.querySelector('[data-act="new-note"]').onclick = () => openNoteForm({ subject_id: subject.id }, reload);
    bindAiPanel(body, subject, reload);

    // O cartao fechado tem altura fixa; so mostra "Ver mais" quando ha texto escondido.
    body.querySelectorAll('.note-card').forEach((card) => {
      const text = card.querySelector('.note-body');
      const button = card.querySelector('[data-act="toggle-note"]');
      if (text.scrollHeight <= text.clientHeight + 1) return;
      button.hidden = false;
      button.onclick = () => {
        const open = card.classList.toggle('open');
        button.textContent = open ? 'Ver menos' : 'Ver mais';
      };
    });
    body.querySelectorAll('[data-act="edit-note"]').forEach((b) => {
      b.onclick = () => openNoteForm(subject.notes.find((n) => n.id === Number(b.dataset.id)), reload);
    });
    body.querySelectorAll('[data-act="del-note"]').forEach((b) => {
      b.onclick = async () => {
        const ok = await confirmDialog({ title: 'Excluir resumo?', message: 'Essa ação não pode ser desfeita.', confirmText: 'Excluir' });
        if (!ok) return;
        try { await api.deleteNote(Number(b.dataset.id)); toast('Resumo excluído.'); await reload(); }
        catch (err) { toast(err.message, 'error'); }
      };
    });
  },

  dates: (body, subject, reload) => bindTaskRows(body, subject.tasks, reload),
};

/* ================================================== linha de tarefa (compartilhada) */

export function taskRow(task, showSubject = false) {
  const done = task.status === 'concluida';
  const due = dueLabel(task.due_date, done);
  // A cor da materia alimenta o brilho do hover (nas abas, vem do modal).
  const color = task.subject_color ? ` style="--row-color:${esc(task.subject_color)}"` : '';
  return `
    <div class="task${done ? ' done' : ''}" data-task="${task.id}"${color}>
      <button class="task-check${done ? ' on' : ''}" data-act="toggle" title="Marcar como concluída">&#10003;</button>
      <div class="task-body">
        <div class="task-title">${esc(task.title)}</div>
        <div class="task-desc">${esc(task.description ?? '')}</div>
        <div class="task-meta">
          ${showSubject && task.subject_name
            ? `<span class="pill"><span class="subject-dot" style="background:${esc(task.subject_color)}"></span>${esc(task.subject_name)}</span>` : ''}
          <span class="pill muted">${esc(KINDS[task.kind] || task.kind)}</span>
          ${task.priority === 'alta' ? '<span class="pill strong">Alta</span>' : ''}
          ${task.status === 'andamento' ? '<span class="pill muted">Em andamento</span>' : ''}
          ${due ? `<span class="pill ${due.tone}">${esc(due.text)}</span>` : ''}
          ${task.assignees?.length
            ? `<span class="avatars">${task.assignees.map((a) => avatar(a, true)).join('')}</span>`
            : '<span class="pill muted">Sem responsável</span>'}
        </div>
      </div>
      <div class="task-actions">
        <button class="btn btn-ghost btn-sm" data-act="edit" title="Editar">Editar</button>
        ${canManage(task) ? '<button class="btn btn-ghost btn-sm btn-danger" data-act="del" title="Excluir">&times;</button>' : ''}
      </div>
    </div>`;
}

export function bindTaskRows(root, tasks, reload) {
  root.querySelectorAll('[data-task]').forEach((row) => {
    const id = Number(row.dataset.task);
    const task = tasks.find((t) => t.id === id);
    if (!task) return;

    row.querySelector('[data-act="toggle"]').onclick = async () => {
      const status = task.status === 'concluida' ? 'pendente' : 'concluida';
      try { await api.updateTask(id, { status }); await reload(); }
      catch (err) { toast(err.message, 'error'); }
    };
    row.querySelector('[data-act="edit"]').onclick = () => openTaskForm(task, reload);
    row.querySelector('[data-act="del"]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Excluir tarefa?', message: esc(task.title), confirmText: 'Excluir' });
      if (!ok) return;
      try { await api.deleteTask(id); toast('Tarefa excluída.'); await reload(); }
      catch (err) { toast(err.message, 'error'); }
    });
  });
}

/* ======================================================= formulario de materia */

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_MB = 8;

const imageField = (slot, label, hint) => `
  <div class="field" data-image="${slot}">
    <label>${esc(label)}</label>
    <div class="image-pick">
      <div class="image-preview" data-preview></div>
      <div class="image-actions">
        <button type="button" class="btn btn-sm" data-act="pick">Escolher imagem</button>
        <button type="button" class="btn btn-sm btn-ghost btn-danger" data-act="clear">Remover</button>
        <input type="file" accept="${IMAGE_TYPES.join(',')}" hidden>
      </div>
    </div>
    <span class="hint">${esc(hint)}</span>
  </div>`;

/**
 * Liga um campo de imagem. Nada vai ao servidor aqui: o arquivo escolhido (ou o
 * pedido de remocao) fica guardado ate o Salvar, porque a materia nova ainda
 * nao tem id para receber a imagem.
 */
function bindImageField(root, slot, currentUrl) {
  const box = root.querySelector(`[data-image="${slot}"]`);
  const preview = box.querySelector('[data-preview]');
  const input = box.querySelector('input[type="file"]');
  const clear = box.querySelector('[data-act="clear"]');
  const pick = { file: null, remove: false, objectUrl: null };

  const paint = () => {
    const url = pick.objectUrl || (pick.remove ? null : currentUrl);
    preview.style.backgroundImage = url ? `url("${url}")` : '';
    preview.textContent = url ? '' : 'Sem imagem';
    clear.hidden = !url;
  };

  box.querySelector('[data-act="pick"]').onclick = () => input.click();
  input.onchange = () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return showFormError(root, 'Envie uma imagem PNG, JPG ou WEBP.');
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) return showFormError(root, `A imagem passa de ${MAX_IMAGE_MB}MB.`);
    if (pick.objectUrl) URL.revokeObjectURL(pick.objectUrl);
    Object.assign(pick, { file, remove: false, objectUrl: URL.createObjectURL(file) });
    paint();
  };
  clear.onclick = () => {
    if (pick.objectUrl) URL.revokeObjectURL(pick.objectUrl);
    Object.assign(pick, { file: null, remove: Boolean(currentUrl), objectUrl: null });
    paint();
  };
  paint();

  return {
    /** Envia/remove no servidor depois que a materia ja existe. */
    async commit(subjectId) {
      if (pick.file) await api.uploadSubjectImage(subjectId, slot, pick.file);
      else if (pick.remove) await api.deleteSubjectImage(subjectId, slot);
    },
    release: () => pick.objectUrl && URL.revokeObjectURL(pick.objectUrl),
  };
}

export function openSubjectForm(subject, onSaved) {
  const editing = Boolean(subject?.id);
  const classes = subject?.classes ?? [];
  let images = [];

  openModal({
    html: `
      <div class="modal-head">
        <div><h3>${editing ? 'Editar matéria' : 'Nova matéria'}</h3>
        <p>${editing ? esc(subject.name) : 'Cadastre a disciplina, o professor e os dias de aula.'}</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        <div class="field-row">
          ${field('Nome da matéria *', `<input type="text" name="name" value="${esc(subject?.name)}" placeholder="Cálculo I">`)}
          ${field('Código', `<input type="text" name="code" value="${esc(subject?.code)}" placeholder="MAT101">`)}
        </div>
        <div class="field-row">
          ${field('Professor', `<input type="text" name="professor" value="${esc(subject?.professor)}" placeholder="Prof. Ana Lima">`)}
          ${field('E-mail do professor', `<input type="email" name="email" value="${esc(subject?.email)}">`)}
        </div>
        <div class="field-row">
          ${field('Sala', `<input type="text" name="room" value="${esc(subject?.room)}" placeholder="Bloco B - 204">`)}
          ${field('Cor', colorPicker(subject?.color))}
        </div>
        <div class="field-row">
          ${imageField('cover', 'Imagem do cartão', 'Fundo do cartão da matéria na aba Matérias.')}
          ${imageField('backdrop', 'Fundo atrás da janela', 'Aparece em volta da janela quando a matéria está aberta.')}
        </div>
        ${field('Observações', `<textarea name="notes" placeholder="Critério de avaliação, bibliografia, combinados da turma...">${esc(subject?.observations)}</textarea>`)}
        <div class="field">
          <label>Dias de aula</label>
          <div data-slot="classes"></div>
          <button type="button" class="btn btn-sm self-start" data-act="add-class">+ Adicionar dia</button>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>Cancelar</button>
        <button class="btn btn-primary" data-act="save">${editing ? 'Salvar' : 'Criar matéria'}</button>
      </div>`,
    onClose: () => images.forEach((i) => i.release()),
    onMount(root, close) {
      bindSwatches(root);
      images = [
        bindImageField(root, 'cover', api.subjectImageUrl(subject, 'cover')),
        bindImageField(root, 'backdrop', api.subjectImageUrl(subject, 'backdrop')),
      ];
      const slot = root.querySelector('[data-slot="classes"]');

      const addRow = (c = {}) => {
        const row = document.createElement('div');
        row.className = 'class-row';
        row.innerHTML = `
          <select name="weekday">${WEEKDAYS.map((d, i) =>
            `<option value="${i}"${Number(c.weekday) === i ? ' selected' : ''}>${d}</option>`).join('')}</select>
          <input type="time" name="starts_at" value="${esc(c.starts_at)}">
          <input type="time" name="ends_at" value="${esc(c.ends_at)}">
          <input type="text" name="room" value="${esc(c.room)}" placeholder="Sala">
          <button type="button" class="btn btn-ghost btn-sm btn-danger" data-act="remove">&times;</button>`;
        row.querySelector('[data-act="remove"]').onclick = () => row.remove();
        slot.append(row);
      };
      classes.forEach(addRow);
      root.querySelector('[data-act="add-class"]').onclick = () => addRow();

      root.querySelector('[data-act="save"]').onclick = async (e) => {
        const payload = {
          semester_id: ctx.state.semesterId,
          name: val(root, 'name'),
          code: val(root, 'code'),
          professor: val(root, 'professor'),
          email: val(root, 'email'),
          room: val(root, 'room'),
          color: root.querySelector('input[name="color"]').value,
          notes: root.querySelector('[name="notes"]').value.trim(),
          classes: [...slot.querySelectorAll('.class-row')].map((r) => ({
            weekday: Number(r.querySelector('[name="weekday"]').value),
            starts_at: r.querySelector('[name="starts_at"]').value,
            ends_at: r.querySelector('[name="ends_at"]').value,
            room: r.querySelector('[name="room"]').value.trim(),
          })),
        };
        if (!payload.name) return showFormError(root, 'Informe o nome da matéria.');
        // Guardado agora: depois do primeiro await o evento ja nao tem currentTarget.
        const button = e.currentTarget;
        let saved;
        try {
          saved = await withBusy(button, () => (editing
            ? api.updateSubject(subject.id, payload)
            : api.createSubject(payload)));
        } catch (err) { return showFormError(root, err.message); }

        // A materia ja foi gravada: se a imagem falhar, avisa sem prender o
        // formulario aberto (salvar de novo criaria uma materia duplicada).
        try {
          await withBusy(button, () => Promise.all(images.map((i) => i.commit(saved.id))));
          toast(editing ? 'Matéria atualizada.' : 'Matéria criada.');
        } catch (err) {
          toast(`Matéria salva, mas a imagem não foi enviada: ${err.message}`, 'error');
        }
        close();
        await onSaved?.();
      };
    },
  });
}

/* ======================================================= formulario de tarefa */

export function openTaskForm(task, onSaved) {
  const editing = Boolean(task?.id);
  const subjects = ctx.state.subjects;
  const selectedIds = new Set((task?.assignees ?? []).map((a) => a.id));

  openModal({
    html: `
      <div class="modal-head">
        <div><h3>${editing ? 'Editar tarefa' : 'Nova tarefa'}</h3>
        <p>Defina o prazo, o tipo e quem fica responsável.</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        ${field('Título *', `<input type="text" name="title" value="${esc(task?.title)}" placeholder="Entregar lista 3">`)}
        ${field('Matéria *', `<select name="subject_id">${subjects.map((s) =>
          `<option value="${s.id}"${Number(task?.subject_id) === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`)}
        <div class="field-row">
          ${field('Tipo', `<select name="kind">${options(KINDS, task?.kind || 'tarefa')}</select>`)}
          ${field('Prioridade', `<select name="priority">${options(PRIORITIES, task?.priority || 'media')}</select>`)}
        </div>
        <div class="field-row">
          ${field('Prazo', `<input type="date" name="due_date" value="${esc(task?.due_date)}">`)}
          ${field('Situação', `<select name="status">${options(STATUSES, task?.status || 'pendente')}</select>`)}
        </div>
        ${field('Descrição', `<textarea name="description" placeholder="O que precisa ser feito, onde entregar...">${esc(task?.description)}</textarea>`)}
        <div class="field">
          <label>Responsáveis</label>
          <div class="checks">
            ${ctx.state.team.map((u) => `
              <label class="check-chip${selectedIds.has(u.id) ? ' on' : ''}">
                <input type="checkbox" name="assignee" value="${u.id}"${selectedIds.has(u.id) ? ' checked' : ''}>
                ${avatar(u, true)} ${esc(u.name)}
              </label>`).join('')}
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>Cancelar</button>
        <button class="btn btn-primary" data-act="save">${editing ? 'Salvar' : 'Criar tarefa'}</button>
      </div>`,
    onMount(root, close) {
      root.querySelectorAll('.check-chip input').forEach((input) => {
        input.onchange = () => input.closest('.check-chip').classList.toggle('on', input.checked);
      });

      root.querySelector('[data-act="save"]').onclick = async (e) => {
        const payload = {
          subject_id: Number(val(root, 'subject_id')),
          title: val(root, 'title'),
          description: root.querySelector('[name="description"]').value.trim(),
          kind: val(root, 'kind'),
          priority: val(root, 'priority'),
          status: val(root, 'status'),
          due_date: val(root, 'due_date'),
          assignees: [...root.querySelectorAll('[name="assignee"]:checked')].map((i) => Number(i.value)),
        };
        if (!payload.title) return showFormError(root, 'Informe o título da tarefa.');
        if (!payload.subject_id) return showFormError(root, 'Selecione a matéria.');
        try {
          await withBusy(e.currentTarget, () => (editing
            ? api.updateTask(task.id, payload)
            : api.createTask(payload)));
          toast(editing ? 'Tarefa atualizada.' : 'Tarefa criada.');
          close();
          await onSaved?.();
        } catch (err) { showFormError(root, err.message); }
      };
    },
  });
}

/* ======================================================= formulario de resumo */

export function openNoteForm(note, onSaved) {
  const editing = Boolean(note?.id);
  openModal({
    html: `
      <div class="modal-head">
        <div><h3>${editing ? 'Editar resumo' : 'Novo resumo'}</h3><p>Anotações e material de estudo da matéria.</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        ${field('Título *', `<input type="text" name="title" value="${esc(note?.title)}" placeholder="Aula 5 - Limites">`)}
        ${field('Conteúdo', `<textarea name="content" style="min-height:280px" placeholder="Escreva o resumo aqui...">${esc(note?.content)}</textarea>`)}
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>Cancelar</button>
        <button class="btn btn-primary" data-act="save">${editing ? 'Salvar' : 'Criar resumo'}</button>
      </div>`,
    onMount(root, close) {
      root.querySelector('[data-act="save"]').onclick = async (e) => {
        const payload = {
          subject_id: note.subject_id,
          title: val(root, 'title'),
          content: root.querySelector('[name="content"]').value,
        };
        if (!payload.title) return showFormError(root, 'Informe o título do resumo.');
        try {
          await withBusy(e.currentTarget, () => (editing
            ? api.updateNote(note.id, payload)
            : api.createNote(payload)));
          toast(editing ? 'Resumo atualizado.' : 'Resumo criado.');
          close();
          await onSaved?.();
        } catch (err) { showFormError(root, err.message); }
      };
    },
  });
}

/* ======================================================= formulario de semestre */

export function openSemesterForm(semester, onSaved) {
  const editing = Boolean(semester?.id);
  openModal({
    html: `
      <div class="modal-head">
        <div><h3>${editing ? 'Editar semestre' : 'Novo semestre'}</h3><p>Cada semestre guarda o próprio conjunto de matérias.</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        ${field('Nome *', `<input type="text" name="name" value="${esc(semester?.name)}" placeholder="2026.1">`)}
        <div class="field-row">
          ${field('Início', `<input type="date" name="starts_on" value="${esc(semester?.starts_on)}">`)}
          ${field('Fim', `<input type="date" name="ends_on" value="${esc(semester?.ends_on)}">`)}
        </div>
        <label class="check-chip${semester?.is_current ? ' on' : ''}">
          <input type="checkbox" name="is_current"${semester?.is_current ? ' checked' : ''}> Marcar como semestre atual
        </label>
      </div>
      <div class="modal-foot">
        ${editing && me().role === 'admin' ? '<button class="btn btn-danger" data-act="delete">Excluir</button>' : ''}
        <div class="spacer"></div>
        <button class="btn" data-close>Cancelar</button>
        <button class="btn btn-primary" data-act="save">${editing ? 'Salvar' : 'Criar semestre'}</button>
      </div>`,
    onMount(root, close) {
      const chip = root.querySelector('.check-chip input');
      chip.onchange = () => chip.closest('.check-chip').classList.toggle('on', chip.checked);

      root.querySelector('[data-act="delete"]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `Excluir o semestre ${semester.name}?`,
          message: 'Todas as matérias, tarefas e resumos deste semestre serão apagados.',
          confirmText: 'Excluir semestre',
        });
        if (!ok) return;
        try {
          await api.deleteSemester(semester.id);
          toast('Semestre excluído.');
          close();
          await onSaved?.(null);
        } catch (err) { showFormError(root, err.message); }
      });

      root.querySelector('[data-act="save"]').onclick = async (e) => {
        const payload = {
          name: val(root, 'name'),
          starts_on: val(root, 'starts_on'),
          ends_on: val(root, 'ends_on'),
          is_current: chip.checked,
        };
        if (!payload.name) return showFormError(root, 'Informe o nome do semestre.');
        try {
          const saved = await withBusy(e.currentTarget, () => (editing
            ? api.updateSemester(semester.id, payload)
            : api.createSemester(payload)));
          toast(editing ? 'Semestre atualizado.' : 'Semestre criado.');
          close();
          await onSaved?.(saved.id);
        } catch (err) { showFormError(root, err.message); }
      };
    },
  });
}

/* ======================================================= formulario de usuario */

const NEW_POSITION = '__new';

export function openUserForm(user, onSaved) {
  const editing = Boolean(user?.id);
  openModal({
    html: `
      <div class="modal-head">
        <div><h3>${editing ? 'Editar pessoa' : 'Adicionar pessoa'}</h3>
        <p>Membros cadastram matérias, tarefas, prazos e responsáveis. Administradores também gerenciam a equipe.</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        ${field('Nome *', `<input type="text" name="name" value="${esc(user?.name)}">`)}
        ${field('E-mail *', `<input type="email" name="email" value="${esc(user?.email)}">`)}
        <div class="field-row">
          ${field('Cargo', `
            <select name="position_id">
              <option value="">Sem cargo</option>
              ${ctx.state.positions.map((p) => `<option value="${p.id}"${p.id === user?.position_id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
              <option value="${NEW_POSITION}">+ Criar novo cargo...</option>
            </select>
            <input type="text" name="new_position" placeholder="Nome do novo cargo" maxlength="60" hidden>`,
            'O cargo é só um rótulo; o que a pessoa pode fazer vem do perfil.')}
          ${field('Perfil', `<select name="role">${options({ member: 'Membro', admin: 'Administrador' }, user?.role || 'member')}</select>`)}
        </div>
        ${field('Cor', colorPicker(user?.color))}
        ${field(editing ? 'Nova senha' : 'Senha *', '<input type="password" name="password" autocomplete="new-password">',
          editing ? 'Deixe em branco para manter a senha atual.' : 'Mínimo de 6 caracteres.')}
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>Cancelar</button>
        <button class="btn btn-primary" data-act="save">${editing ? 'Salvar' : 'Adicionar'}</button>
      </div>`,
    onMount(root, close) {
      bindSwatches(root);
      const positionSelect = root.querySelector('[name="position_id"]');
      const newPosition = root.querySelector('[name="new_position"]');
      positionSelect.onchange = () => {
        newPosition.hidden = positionSelect.value !== NEW_POSITION;
        if (!newPosition.hidden) newPosition.focus();
      };

      root.querySelector('[data-act="save"]').onclick = async (e) => {
        const payload = {
          name: val(root, 'name'),
          email: val(root, 'email'),
          role: val(root, 'role'),
          color: root.querySelector('input[name="color"]').value,
          position_id: positionSelect.value === NEW_POSITION ? null : (Number(positionSelect.value) || null),
        };
        const password = root.querySelector('[name="password"]').value;
        if (password) payload.password = password;
        const creatingPosition = positionSelect.value === NEW_POSITION;
        if (!payload.name || !payload.email) return showFormError(root, 'Nome e e-mail são obrigatórios.');
        if (!editing && !password) return showFormError(root, 'Defina uma senha inicial.');
        if (creatingPosition && !newPosition.value.trim()) return showFormError(root, 'Informe o nome do novo cargo.');
        try {
          await withBusy(e.currentTarget, async () => {
            // O cargo novo nasce primeiro; se ele ja existir, o erro para aqui.
            if (creatingPosition) {
              const created = await api.createPosition({ name: newPosition.value.trim() });
              payload.position_id = created.id;
              // Um segundo Salvar (se a conta falhar) reusa o cargo em vez de recria-lo.
              ctx.state.positions.push(created);
              positionSelect.querySelector(`option[value="${NEW_POSITION}"]`)
                .insertAdjacentHTML('beforebegin', `<option value="${created.id}">${esc(created.name)}</option>`);
              positionSelect.value = String(created.id);
              newPosition.hidden = true;
            }
            return editing ? api.updateUser(user.id, payload) : api.createUser(payload);
          });
          toast(editing ? 'Cadastro atualizado.' : 'Pessoa adicionada.');
          close();
          await onSaved?.();
        } catch (err) { showFormError(root, err.message); }
      };
    },
  });
}

/* ======================================================= formulario de cargo */

export function openPositionForm(position, onSaved) {
  const editing = Boolean(position?.id);
  openModal({
    compact: true,
    html: `
      <div class="modal-head">
        <div><h3>${editing ? 'Renomear cargo' : 'Novo cargo'}</h3>
        <p>${editing
          ? `${position.members} pessoa(s) com esse cargo recebem o nome novo.`
          : 'Ex.: Líder, Revisor, Apresentador. Depois, atribua um a cada pessoa.'}</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        ${field('Nome do cargo *', `<input type="text" name="name" maxlength="60" value="${esc(position?.name)}">`)}
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>Cancelar</button>
        <button class="btn btn-primary" data-act="save">${editing ? 'Salvar' : 'Criar cargo'}</button>
      </div>`,
    onMount(root, close) {
      const save = async (e) => {
        const name = val(root, 'name');
        if (!name) return showFormError(root, 'Informe o nome do cargo.');
        try {
          await withBusy(e.currentTarget, () => (editing
            ? api.updatePosition(position.id, { name })
            : api.createPosition({ name })));
          toast(editing ? 'Cargo renomeado.' : 'Cargo criado.');
          close();
          await onSaved?.();
        } catch (err) { showFormError(root, err.message); }
      };
      const button = root.querySelector('[data-act="save"]');
      button.onclick = save;
      root.querySelector('[name="name"]').onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); button.click(); }
      };
    },
  });
}

/* ======================================================= editar o proprio perfil */

export function openProfileForm(onSaved) {
  const user = me();
  openModal({
    html: `
      <div class="modal-head">
        <div><h3>Editar perfil</h3><p>Seu nome, e-mail de acesso e a cor do seu avatar.</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        ${field('Nome *', `<input type="text" name="name" value="${esc(user.name)}" autocomplete="name">`)}
        ${field('E-mail *', `<input type="email" name="email" value="${esc(user.email)}" autocomplete="email">`,
          'É o e-mail que você usa para entrar.')}
        ${field('Cor', colorPicker(user.color))}
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>Cancelar</button>
        <button class="btn btn-primary" data-act="save">Salvar</button>
      </div>`,
    onMount(root, close) {
      bindSwatches(root);
      root.querySelector('[data-act="save"]').onclick = async (e) => {
        const payload = {
          name: val(root, 'name'),
          email: val(root, 'email'),
          color: root.querySelector('input[name="color"]').value,
        };
        if (!payload.name || !payload.email) return showFormError(root, 'Nome e e-mail são obrigatórios.');
        try {
          const { user: saved } = await withBusy(e.currentTarget, () => api.updateMe(payload));
          toast('Perfil atualizado.');
          close();
          await onSaved?.(saved);
        } catch (err) { showFormError(root, err.message); }
      };
    },
  });
}

/* ======================================================= convidar participante */

export function openInviteForm(onSent) {
  openModal({
    compact: true,
    html: `
      <div class="modal-head">
        <div><h3>Convidar participante</h3>
        <p>A pessoa recebe um link para criar a própria conta, com nome e senha dela. O link vale 7 dias.</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        ${field('E-mail *', '<input type="email" name="email" placeholder="colega@email.com" autocomplete="off">')}
        <div class="field-row">
          ${field('Cargo', `<select name="position_id"><option value="">Sem cargo</option>
            ${ctx.state.positions.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>`)}
          ${field('Perfil', `<select name="role">${options({ member: 'Membro', admin: 'Administrador' }, 'member')}</select>`)}
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>Cancelar</button>
        <button class="btn btn-primary" data-act="send">Enviar convite</button>
      </div>`,
    onMount(root, close) {
      const send = root.querySelector('[data-act="send"]');
      root.querySelector('[name="email"]').onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); send.click(); }
      };
      send.onclick = async (e) => {
        const email = val(root, 'email');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showFormError(root, 'Informe um e-mail válido.');
        try {
          const result = await withBusy(e.currentTarget, () => api.createInvite({
            email,
            role: val(root, 'role'),
            position_id: Number(val(root, 'position_id')) || null,
          }));
          close();
          showInviteResult(result);
          await onSent?.();
        } catch (err) { showFormError(root, err.message); }
      };
    },
  });
}

/** Copia texto; fora de HTTPS/localhost o navigator.clipboard nao existe. */
async function copyText(input) {
  try {
    await navigator.clipboard.writeText(input.value);
    return true;
  } catch {
    input.select();
    return document.execCommand('copy');
  }
}

/**
 * Resultado de criar/reenviar convite. O link aparece sempre: se o e-mail nao
 * saiu (sem SMTP ou erro), e por ele que a pessoa entra.
 */
export function showInviteResult(result) {
  const email = esc(result.invite.email);
  const title = result.emailed ? 'Convite enviado' : 'Convite criado';
  const lead = result.emailed
    ? `Enviamos o convite para <strong>${email}</strong>. Se não chegar, confira o spam ou mande o link abaixo.`
    : `Copie o link abaixo e envie para <strong>${email}</strong> (WhatsApp, e-mail...).`;
  const notes = [
    result.email_error && `<div class="form-error">${esc(result.email_error)} Envie o link manualmente.</div>`,
    !result.mail_enabled && !result.email_error
      && '<p class="hint">O envio automático está desligado. Para ligar, preencha SMTP_HOST, SMTP_USER e SMTP_PASS no .env (veja .env.example) e reinicie o servidor.</p>',
    result.base_is_local
      && `<div class="notice"><strong>Atenção:</strong> o link aponta para ${esc(result.base_url)}, que só abre neste computador.
          Para a pessoa conseguir entrar, defina APP_URL no .env com o endereço da máquina na rede
          (ex.: http://192.168.0.10:4000) ou um endereço público, reinicie o servidor e reenvie o convite.</div>`,
  ].filter(Boolean).join('');

  openModal({
    compact: true,
    html: `
      <div class="modal-head">
        <div><h3>${title}</h3><p>${lead}</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>Link do convite (uso único, vale 7 dias)</label>
          <div class="copy-row">
            <input type="text" readonly value="${esc(result.link)}">
            <button class="btn" data-act="copy">Copiar</button>
          </div>
        </div>
        ${notes}
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary" data-close>Fechar</button>
      </div>`,
    onMount(root) {
      const input = root.querySelector('.copy-row input');
      root.querySelector('[data-act="copy"]').onclick = async () => {
        toast(await copyText(input) ? 'Link copiado.' : 'Não deu para copiar: selecione o link e copie.', 'ok');
      };
    },
  });
}

/* ======================================================= trocar a propria senha */

export function openPasswordForm() {
  openModal({
    html: `
      <div class="modal-head"><div><h3>Alterar minha senha</h3></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button></div>
      <div class="modal-body">
        ${field('Senha atual', '<input type="password" name="current" autocomplete="current-password">')}
        ${field('Nova senha', '<input type="password" name="next" autocomplete="new-password">', 'Mínimo de 6 caracteres.')}
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>Cancelar</button>
        <button class="btn btn-primary" data-act="save">Alterar senha</button>
      </div>`,
    onMount(root, close) {
      root.querySelector('[data-act="save"]').onclick = async (e) => {
        try {
          await withBusy(e.currentTarget, () => api.changePassword({
            current: root.querySelector('[name="current"]').value,
            next: root.querySelector('[name="next"]').value,
          }));
          toast('Senha alterada.');
          close();
        } catch (err) { showFormError(root, err.message); }
      };
    },
  });
}
