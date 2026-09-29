/**
 * Leitura do material anexado, para o texto entrar no prompt.
 *
 *  - PDF "digital" (slides exportados, artigos): o texto ja esta no arquivo;
 *    sai direto, pagina por pagina, sem IA e sem custo.
 *  - Foto (slide, quadro) ou PDF escaneado (paginas sem texto): o Gemini
 *    transcreve. Sem chave de IA o arquivo fica como "needs_ai".
 *
 * Roda uma vez, quando o arquivo e anexado (ou em "Ler de novo"); o texto fica
 * guardado no anexo e os prompts seguintes so leem do banco.
 */
import { extractText, getDocumentProxy } from 'unpdf';
import { AiError, generate, isEnabled } from './ai.js';

/** Media de caracteres por pagina abaixo disso = PDF de imagem (escaneado). */
const MIN_CHARS_PER_PAGE = 80;
/** Teto do texto guardado por arquivo (~100 paginas densas). */
const MAX_STORED_CHARS = 200_000;
const TRANSCRIBE_TIMEOUT_MS = 90_000;
const NO_TEXT = 'SEM TEXTO';

const TRANSCRIBE_PROMPT = [
  'Transcreva fielmente todo o texto deste material de aula (slides, foto do quadro, apostila).',
  'Regras:',
  '- Mantenha a ordem de leitura. Em PDF, comece cada página com uma linha [p. N].',
  '- Não resuma, não comente e não invente: só o que está escrito.',
  '- Figuras, gráficos ou diagramas importantes: descreva em uma linha entre colchetes, ex.: [figura: ciclo de Deming].',
  '- Tabelas: uma linha por linha da tabela, colunas separadas por " | ".',
  `- Se não houver texto legível, responda apenas: ${NO_TEXT}`,
].join('\n');

/** Espacos e quebras em excesso so gastam prompt. */
const tidy = (s) => s
  .replace(/[ \t]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

async function readPdfText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = text.map((t) => tidy(t));
  const chars = pages.reduce((sum, p) => sum + p.length, 0);
  return { totalPages, pages, digital: chars / Math.max(1, totalPages) >= MIN_CHARS_PER_PAGE };
}

async function transcribe(buffer, mime) {
  const parts = [{
    type: mime === 'application/pdf' ? 'document' : 'image',
    data: buffer.toString('base64'),
    mime_type: mime,
  }];
  const text = tidy(await generate(TRANSCRIBE_PROMPT, { parts, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) }));
  return text.toUpperCase().startsWith(NO_TEXT) ? '' : text;
}

/**
 * Le um arquivo e devolve o que gravar no anexo:
 * { status: 'ok'|'empty'|'needs_ai'|'failed', method: 'pdf'|'ia'|null, text, pages, error }
 * Nunca lanca: falha vira status 'failed' com a mensagem, para a tela mostrar.
 */
export async function extractFromFile(buffer, mime) {
  try {
    if (mime === 'application/pdf') {
      const pdf = await readPdfText(buffer);
      if (pdf.digital) {
        const text = pdf.pages
          .map((p, i) => (p ? `[p. ${i + 1}]\n${p}` : ''))
          .filter(Boolean)
          .join('\n\n');
        return { status: 'ok', method: 'pdf', text: text.slice(0, MAX_STORED_CHARS), pages: pdf.totalPages, error: null };
      }
      // Poucas letras por pagina: e um PDF de imagem. Cai para a IA.
    }

    if (!isEnabled()) {
      return { status: 'needs_ai', method: null, text: null, pages: null, error: null };
    }
    const text = await transcribe(buffer, mime);
    if (!text) return { status: 'empty', method: 'ia', text: null, pages: null, error: null };
    return { status: 'ok', method: 'ia', text: text.slice(0, MAX_STORED_CHARS), pages: null, error: null };
  } catch (err) {
    const message = err instanceof AiError || err?.name === 'TimeoutError'
      ? (err.name === 'TimeoutError' ? 'A leitura demorou demais.' : err.message)
      : 'Não foi possível ler este arquivo.';
    if (!(err instanceof AiError)) console.error('Falha ao ler anexo:', err);
    return { status: 'failed', method: null, text: null, pages: null, error: message };
  }
}
