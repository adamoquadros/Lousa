/**
 * Painel de IA da aba Resumos: anexos + botoes de geracao.
 *
 * O fluxo que a turma usa: joga foto do slide, PDF e material na area de
 * anexos, depois clica em uma das opcoes. Cada arquivo e LIDO quando chega
 * (PDF digital direto; foto e PDF escaneado pela IA) e o texto entra no
 * prompt - entao o "copiar prompt" ja leva o conteudo das aulas junto.
 *
 * Com chave configurada o botao gera e salva sozinho. Sem chave ele entrega o
 * prompt pronto para copiar ou abrir no claude.ai.
 */
import { api } from './api.js';
import { confirmDialog, esc, openModal, toast } from './ui.js';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif';
const ICON = (mime) => (mime === 'application/pdf' ? 'PDF' : 'IMG');
const MAX_FILE_MB = 4;

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
  drop.hidden = !canUpload;

  const info = await status();

  /* ------------------------------------------------------------ anexos */

  // Quais anexos entram no prompt. Novo arquivo ja lido entra marcado; a
  // escolha de quem esta na tela e mantida quando a lista e redesenhada.
  const selected = new Set();
  const seen = new Set();

  async function renderFiles() {
    let files = [];
    try { files = await api.attachments(subject.id); }
    catch { filesBox.innerHTML = '<span class="muted-text">Não foi possível listar os anexos.</span>'; return; }

    for (const f of files) {
      if (!seen.has(f.id) && f.extract_status === 'ok') selected.add(f.id);
      seen.add(f.id);
    }
    for (const id of [...selected]) if (!files.some((f) => f.id === id)) selected.delete(id);

    if (!files.length) {
      filesBox.innerHTML = '<span class="muted-text">Nenhum material anexado ainda.</span>';
      return;
    }

    const total = files.reduce((sum, f) => sum + f.size, 0);
    filesBox.innerHTML = `
      <div class="ai-files-head muted-text">${files.length} arquivo(s) · ${humanSize(total)} ·
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
      if (ok) toast(`${ok} arquivo(s) anexado(s).`);
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
    return;
  }

  const auto = info.enabled && canGenerate;
  state.textContent = auto
    ? `automático via ${info.provider} (${info.model})`
    : info.enabled
      ? 'seu perfil não gera com IA: os botões entregam o prompt para colar'
      : 'sem chave configurada: gera o prompt para você colar';

  actions.innerHTML = info.presets.map((p) => `
    <button class="btn btn-sm ai-btn" data-preset="${esc(p.id)}" title="${esc(p.hint)}">
      ${esc(p.label)}
    </button>`).join('');

  /** O que o usuario escolheu agora: anexos marcados + foco. */
  const choice = () => ({ files: [...selected], focus: focusInput.value.trim() });

  actions.querySelectorAll('.ai-btn').forEach((btn) => {
    btn.onclick = () => (auto
      ? runGenerate(btn, subject, reload, choice())
      : showPrompt(subject, btn.dataset.preset, choice()));
  });
}

async function runGenerate(btn, subject, reload, opts) {
  const preset = btn.dataset.preset;
  const label = btn.textContent;
  const siblings = [...btn.parentElement.querySelectorAll('.ai-btn')];

  siblings.forEach((b) => { b.disabled = true; });
  btn.textContent = 'Gerando...';

  try {
    const note = await api.aiGenerate(subject.id, preset, opts);
    const used = note.used_attachments?.length || 0;
    toast(used ? `Resumo gerado a partir de ${used} arquivo(s).` : 'Resumo gerado.');
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
    siblings.forEach((b) => { b.disabled = false; });
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

/** Modal com o prompt pronto: copiar, abrir no claude.ai ou colar a resposta. */
async function showPrompt(subject, preset, opts) {
  let data;
  try { data = await api.aiPrompt(subject.id, preset, opts); }
  catch (err) { return toast(err.message, 'error'); }

  openModal({
    html: `
      <div class="modal-head">
        <div>
          <h3>${esc(data.label)}</h3>
          <p>${esc(subject.name)} · ${thousands(data.chars)} caracteres</p>
        </div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        ${materialSummary(data.material)}
        <p class="muted-text">
          Copie o prompt e cole no chat da sua preferência${data.claude_url ? ' ou abra-o já preenchido' : ''}.
          ${data.claude_url ? '' : 'Ele é longo demais para o link direto: use Copiar.'}
        </p>
        <textarea class="ai-prompt" readonly>${esc(data.prompt)}</textarea>
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>Fechar</button>
        <button class="btn ${data.claude_url ? '' : 'btn-primary'}" data-act="copy">Copiar prompt</button>
        ${data.claude_url ? `<a class="btn btn-primary" data-act="open" href="${esc(data.claude_url)}"
           target="_blank" rel="noopener">Abrir no Claude</a>` : ''}
      </div>`,
    onMount: (root) => {
      const area = root.querySelector('.ai-prompt');
      root.querySelector('[data-act="copy"]').onclick = async () => {
        try {
          await navigator.clipboard.writeText(data.prompt);
          toast('Prompt copiado.');
        } catch {
          // clipboard exige contexto seguro; em http:// sobra selecionar na mao.
          area.focus();
          area.select();
          toast('Texto selecionado: use Ctrl+C para copiar.');
        }
      };
    },
  });
}

/** Previa do texto lido de um anexo: para conferir se a leitura ficou boa. */
async function showText(attachmentId) {
  let data;
  try { data = await api.attachmentText(attachmentId); }
  catch (err) { return toast(err.message, 'error'); }
  const how = data.method === 'pdf'
    ? `lido direto do PDF${data.pages ? ` · ${data.pages} página(s)` : ''}`
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
