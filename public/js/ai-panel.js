/**
 * Painel de IA da aba Resumos: anexos + botoes de geracao.
 *
 * O fluxo que a turma usa: joga foto do slide, PDF e material na area de
 * anexos, depois clica em uma das opcoes. Cada arquivo e LIDO quando chega
 * (PDF digital direto; foto e PDF escaneado pela IA) e o texto entra no
 * prompt - entao o "copiar prompt" ja leva o conteudo das aulas junto.
 *
 * O tipo de resumo sai de uma lista suspensa com busca. Com chave configurada,
 * "Gerar e salvar" gera sozinho; "Ver prompt" sempre entrega o prompt pronto
 * (editavel) para copiar ou abrir no Claude, ChatGPT ou Gemini.
 */
import { api } from './api.js';
import { confirmDialog, esc, openModal, plural, toast } from './ui.js';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif';
const ICON = (mime) => (mime === 'application/pdf' ? 'PDF' : 'IMG');
const MAX_FILE_MB = 4;
const LAST_PRESET_KEY = 'lousa.ai.preset';

/**
 * Chats para onde o prompt pode ir. param: nome do parametro que pre-preenche
 * a conversa pela URL (o Gemini nao tem: la o caminho e colar).
 */
const CHATS = [
  { label: 'Claude', url: 'https://claude.ai/new', param: 'q' },
  { label: 'ChatGPT', url: 'https://chatgpt.com/', param: 'q' },
  { label: 'Gemini', url: 'https://gemini.google.com/app', param: null },
];
/** Acima disso o link com o prompt na URL pode nao abrir: vai so copiado. */
const MAX_LINK_CHARS = 6_000;

let cached = null;

async function status() {
  if (!cached) {
    try { cached = await api.aiStatus(); }
    catch { cached = { enabled: false, presets: [], reason: 'Não foi possível consultar o status da IA.' }; }
  }
  return cached;
}

const humanSize = (bytes) => (bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
  : `${Math.max(1, Math.round(bytes / 1024))}KB`);

const thousands = (n) => Number(n || 0).toLocaleString('pt-BR');

/** Como ficou a leitura de cada arquivo, em palavras. */
function readLabel(f) {
  switch (f.extract_status) {
    case 'ok':
      return {
        tone: 'ok',
        text: f.extract_method === 'pdf'
          ? `texto lido${f.extract_pages ? ` · ${f.extract_pages} pág.` : ''}`
          : 'lido pela IA',
      };
    case 'empty': return { tone: 'muted', text: 'sem texto legível' };
    case 'needs_ai': return { tone: 'warn', text: 'imagem: precisa da IA para ler' };
    case 'failed': return { tone: 'warn', text: `não foi lido: ${f.extract_error || 'falha'}` };
    default: return { tone: 'muted', text: 'ainda não lido' };
  }
}

/* ------------------------------------------------------------ busca de tipos */

/** Um caractere sem acento e minusculo ("Ç" -> "c"). */
const foldChar = (ch) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Texto dobrado (sem acento, minusculo) e, para cada posicao dele, a posicao
 * correspondente no original - e o que deixa destacar o trecho achado mesmo
 * quando a busca foi "questao" e o texto diz "questão".
 */
function fold(text) {
  let out = '';
  const map = [];
  [...text].forEach((ch, i) => {
    for (const f of foldChar(ch)) { out += f; map.push(i); }
  });
  return { text: out, map, chars: [...text] };
}

const queryWords = (q) => fold(q.trim()).text.split(/\s+/).filter(Boolean);

/** Toda palavra da busca aparece em algum lugar do tipo (nome, descricao, termos). */
function matches(preset, words) {
  if (!words.length) return true;
  const hay = fold([preset.label, preset.hint, preset.keywords, preset.group].join(' ')).text;
  return words.every((w) => hay.includes(w));
}

/** Texto escapado com <mark> em cada ocorrencia das palavras buscadas. */
function highlight(text, words) {
  if (!words.length) return esc(text);
  const f = fold(text);
  const hit = new Array(f.chars.length).fill(false);
  for (const w of words) {
    for (let at = f.text.indexOf(w); at !== -1; at = f.text.indexOf(w, at + 1)) {
      for (let k = at; k < at + w.length; k += 1) hit[f.map[k]] = true;
    }
  }
  let html = '';
  let open = false;
  f.chars.forEach((ch, i) => {
    if (hit[i] !== open) { html += hit[i] ? '<mark>' : '</mark>'; open = hit[i]; }
    html += esc(ch);
  });
  return open ? `${html}</mark>` : html;
}

function loadLastPreset() {
  try { return localStorage.getItem(LAST_PRESET_KEY); } catch { return null; }
}
function saveLastPreset(id) {
  try { localStorage.setItem(LAST_PRESET_KEY, id); } catch { /* navegador sem storage */ }
}

export function aiPanelHtml() {
  return `
    <div class="ai-panel" data-ai-panel>
      <div class="ai-panel-head">
        <strong>Material e geração</strong>
        <span class="muted-text" data-ai-state>carregando...</span>
      </div>

      <div class="ai-drop" data-drop tabindex="0" role="button"
           aria-label="Anexar arquivos da matéria">
        <input type="file" data-file-input multiple accept="${ACCEPT}" hidden>
        <strong data-drop-title>Anexar material</strong>
        <span class="muted-text">PDFs e fotos de slides ou do quadro (até 4MB cada). O texto é lido e entra no prompt.</span>
      </div>

      <div class="ai-files" data-files></div>
      <div class="ai-meter" data-meter hidden></div>

      <div class="ai-focus">
        <label for="ai-type-input">Tipo de resumo</label>
        <div class="ai-combo" data-combo>
          <input type="text" id="ai-type-input" data-combo-input autocomplete="off" spellcheck="false"
                 role="combobox" aria-expanded="false" aria-controls="ai-type-list" aria-autocomplete="list"
                 placeholder="Busque por qualquer palavra: prova, flashcards, slides...">
          <span class="ai-combo-caret" aria-hidden="true">&#9662;</span>
          <div class="ai-combo-list" id="ai-type-list" role="listbox" data-combo-list hidden></div>
        </div>
        <span class="ai-type-hint muted-text" data-type-hint></span>
      </div>

      <div class="ai-focus">
        <label for="ai-focus-input">Foco <span class="muted-text">(opcional)</span></label>
        <input type="text" id="ai-focus-input" data-focus maxlength="300"
               placeholder="Ex.: só a unidade 2 · prova sobre Dejours e Clot · ênfase em ergonomia">
      </div>

      <div class="ai-actions" data-ai-actions></div>
    </div>`;
}

/**
 * rights vem do perfil de quem esta logado:
 *  - canUpload: anexar e reler material (sem ele, a area de anexar some);
 *  - canDeleteFile(f): remover aquele anexo (quem enviou, ou quem tem o direito);
 *  - canGenerate: gerar com IA (sem ele, os botoes entregam o prompt para colar).
 */
export async function bindAiPanel(body, subject, reload, rights = {}) {
  const { canUpload = true, canDeleteFile = () => true, canGenerate = true } = rights;
  const panel = body.querySelector('[data-ai-panel]');
  if (!panel) return;

  const state = panel.querySelector('[data-ai-state]');
  const actions = panel.querySelector('[data-ai-actions]');
  const filesBox = panel.querySelector('[data-files]');
  const drop = panel.querySelector('[data-drop]');
  const dropTitle = panel.querySelector('[data-drop-title]');
  const input = panel.querySelector('[data-file-input]');
  const focusInput = panel.querySelector('[data-focus]');
  const meter = panel.querySelector('[data-meter]');
  drop.hidden = !canUpload;

  const info = await status();

  /* ------------------------------------------------------------ anexos */

  // Quais anexos entram no prompt. Novo arquivo ja lido entra marcado; a
  // escolha de quem esta na tela e mantida quando a lista e redesenhada.
  const selected = new Set();
  const seen = new Set();
  let listed = [];

  /**
   * Quanto do material marcado cabe no prompt, antes de gerar. A conta e a
   * mesma do servidor (texto lido, ate max_material_chars); passou, avisa.
   */
  function updateMeter() {
    const picked = listed.filter((f) => selected.has(f.id));
    meter.hidden = !listed.length;
    if (!picked.length) {
      meter.className = 'ai-meter';
      meter.innerHTML = 'Nenhum arquivo marcado: o prompt vai só com o contexto da matéria.';
      return;
    }
    const max = info.max_material_chars || 60_000;
    const chars = picked.reduce((sum, f) => sum + (f.extract_status === 'ok' ? f.text_chars || 0 : 0), 0);
    const unread = picked.filter((f) => f.extract_status !== 'ok').length;
    const over = chars > max;
    meter.className = `ai-meter${over ? ' over' : ''}`;
    meter.innerHTML = `
      <div class="ai-meter-bar"><span style="width:${Math.min(100, (chars / max) * 100).toFixed(1)}%"></span></div>
      <div class="ai-meter-text">
        ${plural(picked.length, 'arquivo marcado', 'arquivos marcados')} · ${thousands(chars)} de ${thousands(max)} caracteres
        ${over ? ' · <strong>passou do limite: o fim do material será cortado</strong>' : ''}
        ${unread ? ` · ${unread} sem texto lido (${info.enabled && canGenerate
          ? (unread === 1 ? 'vai como arquivo' : 'vão como arquivos') + ' na geração automática'
          : (unread === 1 ? 'anexe-o' : 'anexe-os') + ' direto no chat'})` : ''}
      </div>`;
  }

  async function renderFiles() {
    let files = [];
    try { files = await api.attachments(subject.id); }
    catch { filesBox.innerHTML = '<span class="muted-text">Não foi possível listar os anexos.</span>'; return; }

    for (const f of files) {
      if (!seen.has(f.id) && f.extract_status === 'ok') selected.add(f.id);
      seen.add(f.id);
    }
    for (const id of [...selected]) if (!files.some((f) => f.id === id)) selected.delete(id);
    listed = files;
    updateMeter();

    if (!files.length) {
      filesBox.innerHTML = '<span class="muted-text">Nenhum material anexado ainda.</span>';
      return;
    }

    const total = files.reduce((sum, f) => sum + f.size, 0);
    filesBox.innerHTML = `
      <div class="ai-files-head muted-text">${plural(files.length, 'arquivo', 'arquivos')} · ${humanSize(total)} ·
        marque o que deve entrar no prompt</div>
      ${files.map((f) => {
        const read = readLabel(f);
        return `
        <div class="ai-file" data-file="${f.id}">
          <input type="checkbox" class="ai-file-pick" data-pick="${f.id}"${selected.has(f.id) ? ' checked' : ''}
                 title="Usar este arquivo no prompt" aria-label="Usar ${esc(f.filename)} no prompt">
          <span class="ai-file-kind">${ICON(f.mime)}</span>
          <div class="ai-file-main">
            <a class="ai-file-name" href="${esc(api.attachmentUrl(f.id))}" target="_blank" rel="noopener"
               title="${esc(f.filename)}">${esc(f.filename)}</a>
            <span class="ai-file-read ${read.tone}">${esc(read.text)}</span>
          </div>
          <span class="ai-file-size muted-text">${humanSize(f.size)}</span>
          ${f.extract_status === 'ok' ? `<button class="btn btn-ghost btn-sm" data-act="view-text" data-id="${f.id}">Ver texto</button>` : ''}
          ${canUpload && f.extract_status !== 'ok' ? `<button class="btn btn-ghost btn-sm" data-act="reread" data-id="${f.id}">Ler de novo</button>` : ''}
          ${canDeleteFile(f) ? `<button class="btn btn-ghost btn-sm" data-act="del-file" data-id="${f.id}"
                  title="Remover anexo">&times;</button>` : ''}
        </div>`;
      }).join('')}`;

    filesBox.querySelectorAll('[data-pick]').forEach((box) => {
      box.onchange = () => {
        const id = Number(box.dataset.pick);
        if (box.checked) selected.add(id); else selected.delete(id);
        updateMeter();
      };
    });
    filesBox.querySelectorAll('[data-act="view-text"]').forEach((b) => {
      b.onclick = () => showText(Number(b.dataset.id));
    });
    filesBox.querySelectorAll('[data-act="reread"]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = 'Lendo...';
        try {
          const f = await api.extractAttachment(Number(b.dataset.id));
          if (f.extract_status === 'ok') selected.add(f.id);
          toast(f.extract_status === 'ok' ? 'Arquivo lido.' : readLabel(f).text, f.extract_status === 'ok' ? 'ok' : 'error');
        } catch (err) { toast(err.message, 'error'); }
        await renderFiles();
      };
    });
    filesBox.querySelectorAll('[data-act="del-file"]').forEach((b) => {
      b.onclick = async () => {
        const ok = await confirmDialog({
          title: 'Remover anexo?',
          message: 'O arquivo sai da matéria e deixa de ser usado nas próximas gerações.',
          confirmText: 'Remover',
        });
        if (!ok) return;
        try { await api.deleteAttachment(Number(b.dataset.id)); await renderFiles(); }
        catch (err) { toast(err.message, 'error'); }
      };
    });
  }

  // Um arquivo por envio: online, a hospedagem recusa requisicoes acima de ~4,5MB.
  // O servidor ja le o conteudo no envio - foto pela IA leva alguns segundos.
  async function send(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    drop.classList.add('busy');
    let ok = 0;
    const failed = [];
    try {
      for (const [i, file] of files.entries()) {
        dropTitle.textContent = `Enviando e lendo ${i + 1} de ${files.length}…`;
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
          failed.push(`${file.name} (passa de ${MAX_FILE_MB}MB)`);
          continue;
        }
        try {
          await api.uploadAttachments(subject.id, [file]);
          ok += 1;
        } catch (err) {
          failed.push(`${file.name} (${err.message})`);
        }
      }
      if (ok) toast(`${plural(ok, 'arquivo anexado', 'arquivos anexados')}.`);
      if (failed.length) toast(`Não foi possível anexar: ${failed.join('; ')}`, 'error');
      await renderFiles();
    } finally {
      drop.classList.remove('busy');
      dropTitle.textContent = 'Anexar material';
      input.value = '';
    }
  }

  drop.onclick = () => input.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => send(input.files);

  // Sem o preventDefault no dragover o navegador abre o arquivo numa aba.
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    send(e.dataTransfer.files);
  };

  await renderFiles();

  /* ------------------------------------------------------------ geracao */

  if (!info.presets?.length) {
    state.textContent = info.reason || 'IA indisponível.';
    panel.querySelector('[data-combo]').closest('.ai-focus').hidden = true;
    return;
  }

  const auto = info.enabled && canGenerate;
  state.textContent = auto
    ? `automático via ${info.provider} (${info.model})`
    : info.enabled
      ? 'seu perfil não gera com IA: "Ver prompt" entrega o texto para colar'
      : 'sem chave configurada: "Ver prompt" entrega o texto para colar';

  const presets = info.presets;
  const combo = panel.querySelector('[data-combo]');
  const typeInput = panel.querySelector('[data-combo-input]');
  const list = panel.querySelector('[data-combo-list]');
  const typeHint = panel.querySelector('[data-type-hint]');

  let current = presets.find((p) => p.id === loadLastPreset()) || null;
  let shown = []; // opcoes visiveis agora, na ordem da tela
  let active = -1; // indice em shown destacado pelo teclado
  let typed = false; // a pessoa digitou desde a ultima escolha?

  actions.innerHTML = `
    ${auto ? '<button class="btn btn-primary btn-sm" data-act="generate">Gerar e salvar</button>' : ''}
    <button class="btn btn-sm${auto ? '' : ' btn-primary'}" data-act="prompt">Ver prompt</button>`;
  const genBtn = actions.querySelector('[data-act="generate"]');
  const promptBtn = actions.querySelector('[data-act="prompt"]');

  function showCurrent() {
    typeInput.value = current ? current.label : '';
    typeHint.textContent = current ? current.hint : 'Escolha um tipo para gerar.';
    actions.querySelectorAll('button').forEach((b) => { b.disabled = !current; });
  }

  function renderList() {
    const words = typed ? queryWords(typeInput.value) : [];
    shown = presets.filter((p) => matches(p, words));
    if (!shown.length) {
      list.innerHTML = `<div class="ai-combo-empty">Nenhum tipo com “${esc(typeInput.value.trim())}”.</div>`;
      active = -1;
      typeInput.removeAttribute('aria-activedescendant');
      return;
    }
    if (active < 0 || active >= shown.length) {
      active = Math.max(0, shown.indexOf(current));
    }
    let group = null;
    list.innerHTML = shown.map((p, i) => {
      const head = p.group !== group ? `<div class="ai-combo-group" role="presentation">${esc(p.group || '')}</div>` : '';
      group = p.group;
      return `${head}
        <div class="ai-combo-option${i === active ? ' active' : ''}" role="option" id="ai-type-${esc(p.id)}"
             data-index="${i}" aria-selected="${p === current}">
          <span class="ai-combo-label">${highlight(p.label, words)}</span>
          <span class="ai-combo-desc">${highlight(p.hint, words)}</span>
        </div>`;
    }).join('');
    typeInput.setAttribute('aria-activedescendant', `ai-type-${shown[active].id}`);
    list.querySelector('.ai-combo-option.active')?.scrollIntoView({ block: 'nearest' });
  }

  const isOpen = () => !list.hidden;
  function openList() {
    list.hidden = false;
    typeInput.setAttribute('aria-expanded', 'true');
    renderList();
  }
  function closeList() {
    list.hidden = true;
    typed = false;
    active = -1;
    typeInput.setAttribute('aria-expanded', 'false');
    typeInput.removeAttribute('aria-activedescendant');
    showCurrent(); // busca abandonada volta a mostrar o tipo escolhido
  }
  function pick(preset) {
    current = preset;
    saveLastPreset(preset.id);
    closeList();
  }

  typeInput.onfocus = () => { typeInput.select(); openList(); };
  typeInput.onclick = () => { if (!isOpen()) openList(); };
  typeInput.oninput = () => { typed = true; active = 0; openList(); };
  typeInput.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen()) { openList(); return; }
      if (!shown.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      renderList();
    } else if (e.key === 'Enter' && isOpen()) {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (e.key === 'Escape' && isOpen()) {
      // Esc com a lista aberta so fecha a lista, nao a janela da materia.
      e.preventDefault();
      e.stopPropagation();
      closeList();
    }
  };
  // mousedown, nao click: o click viria depois do blur que fecha a lista.
  list.onmousedown = (e) => {
    e.preventDefault();
    const option = e.target.closest('[data-index]');
    if (option) pick(shown[Number(option.dataset.index)]);
  };
  combo.addEventListener('focusout', (e) => {
    if (!combo.contains(e.relatedTarget)) closeList();
  });

  showCurrent();

  /** O que o usuario escolheu agora: anexos marcados + foco. */
  const choice = () => ({ files: [...selected], focus: focusInput.value.trim() });

  if (genBtn) genBtn.onclick = () => runGenerate(genBtn, [genBtn, promptBtn], subject, current.id, reload, choice());
  promptBtn.onclick = () => showPrompt(subject, current.id, choice());
}

async function runGenerate(btn, buttons, subject, preset, reload, opts) {
  const label = btn.textContent;
  buttons.forEach((b) => { b.disabled = true; });
  btn.textContent = 'Gerando...';

  try {
    const note = await api.aiGenerate(subject.id, preset, opts);
    const used = note.used_attachments?.length || 0;
    toast(used ? `Resumo gerado a partir de ${plural(used, 'arquivo', 'arquivos')}.` : 'Resumo gerado.');
    // Arquivo que ficou de fora e informacao demais para um toast secundario
    // sumir com ela: avisa separado, nomeando o que nao entrou.
    if (note.skipped_attachments?.length) {
      const names = note.skipped_attachments.map((s) => s.filename).join(', ');
      toast(`Não coube (ou entrou só em parte) nesta geração: ${names}`, 'error');
    }
    await reload();
  } catch (err) {
    toast(err.message, 'error');
    // A geracao falhou, mas o prompt continua util: oferece o caminho manual.
    showPrompt(subject, preset, opts);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
    btn.textContent = label;
  }
}

/** Resumo do material que entrou no prompt, para a pessoa conferir antes de colar. */
function materialSummary(m) {
  const lines = [];
  lines.push(m.included.length
    ? `<div><strong>Material incluído:</strong> ${esc(m.included.join(', '))} · ${thousands(m.chars)} caracteres</div>`
    : '<div><strong>Nenhum material de texto incluído.</strong> Marque arquivos lidos no painel para eles entrarem.</div>');
  if (m.truncated.length) {
    lines.push(`<div class="warn">Cortado por tamanho: ${esc(m.truncated.join(', '))}. Desmarque arquivos para caber o que importa.</div>`);
  }
  if (m.unread.length) {
    lines.push(`<div class="warn">Marcados, mas sem texto lido: ${esc(m.unread.map((u) => u.filename).join(', '))}. Anexe-os no chat se quiser que entrem.</div>`);
  }
  return `<div class="ai-summary">${lines.join('')}</div>`;
}

/** Copia; sem clipboard (http://) seleciona o texto para o Ctrl+C. */
async function copyText(text, area) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    area.focus();
    area.select();
    return false;
  }
}

/**
 * Modal com o prompt pronto e editavel: copiar ou abrir num chat. O botao do
 * chat sempre copia; quando o prompt cabe no link, ele ja chega preenchido.
 */
async function showPrompt(subject, preset, opts) {
  let data;
  try { data = await api.aiPrompt(subject.id, preset, opts); }
  catch (err) { toast(err.message, 'error'); return; }

  openModal({
    html: `
      <div class="modal-head">
        <div>
          <h3>${esc(data.label)}</h3>
          <p>${esc(subject.name)} · <span data-count>${thousands(data.chars)}</span> caracteres</p>
        </div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        ${materialSummary(data.material)}
        <p class="muted-text ai-prompt-help">
          Revise e edite à vontade. Os botões de chat copiam o prompt e abrem a conversa:
          se ele for curto, já chega preenchido; se for longo, é só colar (Ctrl+V).
        </p>
        <textarea class="ai-prompt" spellcheck="false" aria-label="Prompt">${esc(data.prompt)}</textarea>
      </div>
      <div class="modal-foot ai-prompt-foot">
        ${CHATS.map((c, i) => `<a class="btn btn-sm" data-chat="${i}" href="${esc(c.url)}"
            target="_blank" rel="noopener">Abrir no ${esc(c.label)}</a>`).join('')}
        <div class="spacer"></div>
        <button class="btn btn-primary" data-act="copy">Copiar prompt</button>
      </div>`,
    onMount: (root) => {
      const area = root.querySelector('.ai-prompt');
      const count = root.querySelector('[data-count]');
      area.oninput = () => { count.textContent = thousands(area.value.length); };

      root.querySelector('[data-act="copy"]').onclick = async () => {
        toast(await copyText(area.value, area) ? 'Prompt copiado.' : 'Texto selecionado: use Ctrl+C para copiar.');
      };

      // O href e trocado no proprio clique, antes da navegacao: assim o link
      // leva o texto editado e a aba abre sem cair no bloqueio de pop-up.
      root.querySelectorAll('[data-chat]').forEach((a) => {
        a.onclick = () => {
          const chat = CHATS[Number(a.dataset.chat)];
          const text = area.value;
          const prefill = chat.param && text.length <= MAX_LINK_CHARS;
          a.href = prefill ? `${chat.url}?${chat.param}=${encodeURIComponent(text)}` : chat.url;
          copyText(text, area).then((copied) => {
            if (prefill) toast(`Abrindo no ${chat.label} com o prompt preenchido.`);
            else if (copied) toast(`Prompt copiado. No ${chat.label}, cole com Ctrl+V.`);
            else toast('Não deu para copiar sozinho: o texto está selecionado, use Ctrl+C.', 'error');
          });
        };
      });
    },
  });
}

/** Previa do texto lido de um anexo: para conferir se a leitura ficou boa. */
async function showText(attachmentId) {
  let data;
  try { data = await api.attachmentText(attachmentId); }
  catch (err) { return toast(err.message, 'error'); }
  const how = data.method === 'pdf'
    ? `lido direto do PDF${data.pages ? ` · ${plural(data.pages, 'página', 'páginas')}` : ''}`
    : 'transcrito pela IA: confira nomes e números';

  openModal({
    html: `
      <div class="modal-head">
        <div><h3>${esc(data.filename)}</h3><p>${esc(how)} · ${thousands(data.text.length)} caracteres</p></div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        <textarea class="ai-prompt" readonly>${esc(data.text)}</textarea>
      </div>
      <div class="modal-foot"><button class="btn btn-primary" data-close>Fechar</button></div>`,
  });
}
