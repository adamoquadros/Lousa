/** Cliente HTTP: sempre JSON, sempre com o cookie de sessao. */
async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Falha na requisição (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Upload multipart: o navegador define o Content-Type com o boundary. */
async function upload(path, files, { method = 'POST', field = 'files' } = {}) {
  const form = new FormData();
  for (const f of files) form.append(field, f);
  const res = await fetch(path, { method, credentials: 'same-origin', body: form });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error(data?.error || `Falha no envio (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const qs = (params) => {
  const s = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return s ? `?${s}` : '';
};

export const api = {
  // sessao
  status: () => request('GET', '/api/auth/status'),
  setup: (payload) => request('POST', '/api/auth/setup', payload),
  login: (payload) => request('POST', '/api/auth/login', payload),
  logout: () => request('POST', '/api/auth/logout'),
  changePassword: (payload) => request('POST', '/api/auth/password', payload),
  updateMe: (payload) => request('PATCH', '/api/auth/me', payload),

  // convites (criar/listar e admin; abrir/aceitar e publico, via token do link)
  invites: () => request('GET', '/api/invites'),
  createInvite: (payload) => request('POST', '/api/invites', payload),
  resendInvite: (id) => request('POST', `/api/invites/${id}/resend`),
  cancelInvite: (id) => request('DELETE', `/api/invites/${id}`),
  inviteInfo: (token) => request('GET', `/api/invites/token/${encodeURIComponent(token)}`),
  acceptInvite: (token, payload) => request('POST', `/api/invites/token/${encodeURIComponent(token)}/accept`, payload),
  team: () => request('GET', '/api/auth/team'),

  // semestres
  semesters: () => request('GET', '/api/semesters'),
  createSemester: (payload) => request('POST', '/api/semesters', payload),
  updateSemester: (id, payload) => request('PATCH', `/api/semesters/${id}`, payload),
  deleteSemester: (id) => request('DELETE', `/api/semesters/${id}`),

  // materias
  subjects: (semesterId) => request('GET', `/api/subjects${qs({ semester: semesterId })}`),
  subject: (id) => request('GET', `/api/subjects/${id}`),
  createSubject: (payload) => request('POST', '/api/subjects', payload),
  updateSubject: (id, payload) => request('PATCH', `/api/subjects/${id}`, payload),
  deleteSubject: (id) => request('DELETE', `/api/subjects/${id}`),

  // imagens da materia: slot 'cover' (cartao) ou 'backdrop' (atras do modal)
  uploadSubjectImage: (id, slot, file) =>
    upload(`/api/subjects/${id}/images/${slot}`, [file], { method: 'PUT', field: 'file' }),
  deleteSubjectImage: (id, slot) => request('DELETE', `/api/subjects/${id}/images/${slot}`),
  /** URL da imagem ou null. O ?v= muda quando a imagem e trocada (fura o cache). */
  subjectImageUrl: (subject, slot) => {
    const file = subject?.[slot === 'cover' ? 'cover_image' : 'backdrop_image'];
    return file ? `/api/subjects/${subject.id}/images/${slot}?v=${encodeURIComponent(file)}` : null;
  },

  // tarefas
  tasks: (filters) => request('GET', `/api/tasks${qs(filters)}`),
  createTask: (payload) => request('POST', '/api/tasks', payload),
  updateTask: (id, payload) => request('PATCH', `/api/tasks/${id}`, payload),
  deleteTask: (id) => request('DELETE', `/api/tasks/${id}`),

  // resumos
  createNote: (payload) => request('POST', '/api/notes', payload),
  updateNote: (id, payload) => request('PATCH', `/api/notes/${id}`, payload),
  deleteNote: (id) => request('DELETE', `/api/notes/${id}`),

  // anexos
  attachments: (subjectId) => request('GET', `/api/subjects/${subjectId}/attachments`),
  uploadAttachments: (subjectId, files) => upload(`/api/subjects/${subjectId}/attachments`, files),
  deleteAttachment: (id) => request('DELETE', `/api/attachments/${id}`),
  attachmentUrl: (id) => `/api/attachments/${id}/file`,

  // ia
  aiStatus: () => request('GET', '/api/ai/status'),
  aiPrompt: (subjectId, preset) => request('GET', `/api/ai/subjects/${subjectId}/prompt${qs({ preset })}`),
  aiGenerate: (subjectId, preset) => request('POST', `/api/ai/subjects/${subjectId}/generate`, { preset }),

  // panorama e equipe (admin)
  overview: (semesterId) => request('GET', `/api/overview${qs({ semester: semesterId })}`),
  users: () => request('GET', '/api/users'),
  createUser: (payload) => request('POST', '/api/users', payload),
  updateUser: (id, payload) => request('PATCH', `/api/users/${id}`, payload),
  deleteUser: (id) => request('DELETE', `/api/users/${id}`),

  // funcoes nas tarefas (listar/criar: todos; renomear/excluir: admin)
  taskRoles: () => request('GET', '/api/task-roles'),
  createTaskRole: (payload) => request('POST', '/api/task-roles', payload),
  updateTaskRole: (id, payload) => request('PATCH', `/api/task-roles/${id}`, payload),
  deleteTaskRole: (id) => request('DELETE', `/api/task-roles/${id}`),

  // perfis de acesso (ver: todos; criar/editar/excluir: direito perfis.gerenciar)
  profiles: () => request('GET', '/api/profiles'),
  createProfile: (payload) => request('POST', '/api/profiles', payload),
  updateProfile: (id, payload) => request('PATCH', `/api/profiles/${id}`, payload),
  deleteProfile: (id) => request('DELETE', `/api/profiles/${id}`),

  // cargos (leitura para todos, alteracao so admin)
  positions: () => request('GET', '/api/positions'),
  createPosition: (payload) => request('POST', '/api/positions', payload),
  updatePosition: (id, payload) => request('PATCH', `/api/positions/${id}`, payload),
  deletePosition: (id) => request('DELETE', `/api/positions/${id}`),
};
