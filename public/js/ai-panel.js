/**
 * Painel de IA da aba Resumos: anexos + botoes de geracao.
 *
 * O fluxo que a turma usa: joga foto do slide, PDF e material na area de
 * anexos, depois clica em uma das opcoes. Os anexos ficam na materia, entao
 * servem para todas as geracoes seguintes - anexa uma vez, gera as 4 versoes.
 *
 * Com chave configurada o botao gera e salva sozinho. Sem chave ele entrega o
 * prompt pronto para copiar ou abrir no claude.ai (ai os arquivos vao na mao).
 */
import { api } from './api.js';
import { confirmDialog, esc, openModal, toast } from './ui.js';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif';
const ICON = (mime) => (mime === 'application/pdf' ? 'PDF' : 'IMG');

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
        <strong>Anexar material</strong>
        <span class="muted-text">Fotos dos slides, PDFs e resumos. Clique ou arraste aqui.</span>
      </div>

      <div class="ai-files" data-files></div>

      <div class="ai-actions" data-ai-actions></div>
    </div>`;
}

export async function bindAiPanel(body, subject, reload) {
  const panel = body.querySelector('[data-ai-panel]');
  if (!panel) return;

  const state = panel.querySelector('[data-ai-state]');
  const actions = panel.querySelector('[data-ai-actions]');
  const filesBox = panel.querySelector('[data-files]');
  const drop = panel.querySelector('[data-drop]');
  const input = panel.querySelector('[data-file-input]');

  const info = await status();

  /* ------------------------------------------------------------ anexos */

  async function renderFiles() {
    let files = [];
    try { files = await api.attachments(subject.id); }
    catch { filesBox.innerHTML = '<span class="muted-text">Não foi possível listar os anexos.</span>'; return; }

    if (!files.length) {
      filesBox.innerHTML = '<span class="muted-text">Nenhum material anexado ainda.</span>';
      return;
    }

    const total = files.reduce((sum, f) => sum + f.size, 0);
    filesBox.innerHTML = `
      <div class="ai-files-head muted-text">${files.length} arquivo(s) · ${humanSize(total)}</div>
      ${files.map((f) => `
        <div class="ai-file" data-file="${f.id}">
          <span class="ai-file-kind">${ICON(f.mime)}</span>
          <a class="ai-file-name" href="${esc(api.attachmentUrl(f.id))}" target="_blank" rel="noopener"
             title="${esc(f.filename)}">${esc(f.filename)}</a>
          <span class="ai-file-size muted-text">${humanSize(f.size)}</span>
          <button class="btn btn-ghost btn-sm" data-act="del-file" data-id="${f.id}"
                  title="Remover anexo">&times;</button>
        </div>`).join('')}`;

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

  async function send(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    drop.classList.add('busy');
    try {
      const saved = await api.uploadAttachments(subject.id, files);
      toast(`${saved.length} arquivo(s) anexado(s).`);
      await renderFiles();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      drop.classList.remove('busy');
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

  state.textContent = info.enabled
    ? `automático via ${info.provider} (${info.model})`
    : 'sem chave configurada: gera o prompt para você colar';

  actions.innerHTML = info.presets.map((p) => `
    <button class="btn btn-sm ai-btn" data-preset="${esc(p.id)}" title="${esc(p.hint)}">
      ${esc(p.label)}
    </button>`).join('');

  actions.querySelectorAll('.ai-btn').forEach((btn) => {
    btn.onclick = () => (info.enabled
      ? runGenerate(btn, subject, reload)
      : showPrompt(subject, btn.dataset.preset));
  });
}

async function runGenerate(btn, subject, reload) {
  const preset = btn.dataset.preset;
  const label = btn.textContent;
  const siblings = [...btn.parentElement.querySelectorAll('.ai-btn')];

  siblings.forEach((b) => { b.disabled = true; });
  btn.textContent = 'Gerando...';

  try {
    const note = await api.aiGenerate(subject.id, preset);
    const used = note.used_attachments?.length || 0;
    toast(used ? `Resumo gerado a partir de ${used} arquivo(s).` : 'Resumo gerado.');
    // Arquivo que ficou de fora e informacao demais para um toast secundario
    // sumir com ela: avisa separado, nomeando o que nao entrou.
    if (note.skipped_attachments?.length) {
      const names = note.skipped_attachments.map((s) => s.filename).join(', ');
      toast(`Não coube nesta geração: ${names}`, 'error');
    }
    await reload();
  } catch (err) {
    toast(err.message, 'error');
    // A geracao falhou, mas o prompt continua util: oferece o caminho manual.
    showPrompt(subject, preset);
  } finally {
    siblings.forEach((b) => { b.disabled = false; });
    btn.textContent = label;
  }
}

/** Modal com o prompt pronto: copiar, abrir no claude.ai ou colar a resposta. */
async function showPrompt(subject, preset) {
  let data;
  try { data = await api.aiPrompt(subject.id, preset); }
  catch (err) { return toast(err.message, 'error'); }

  openModal({
    html: `
      <div class="modal-head">
        <div>
          <h3>${esc(data.label)}</h3>
          <p>${esc(subject.name)} · ${data.chars} caracteres</p>
        </div>
        <div class="spacer"></div><button class="btn btn-ghost btn-sm" data-close>&times;</button>
      </div>
      <div class="modal-body">
        <p class="muted-text">
          Copie o prompt e cole no chat da sua preferência ou abra-o já preenchido.
          Anexe os arquivos da matéria no chat antes de enviar: por aqui, eles não vão junto.
        </p>
        <textarea class="ai-prompt" readonly>${esc(data.prompt)}</textarea>
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>Fechar</button>
        <button class="btn" data-act="copy">Copiar prompt</button>
        <a class="btn btn-primary" data-act="open" href="${esc(data.claude_url)}"
           target="_blank" rel="noopener">Abrir no Claude</a>
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
