/**
 * Adaptador de IA. O resto do app nao sabe qual provedor esta atras: manda um
 * prompt em texto, recebe texto de volta. Trocar de provedor e escrever outra
 * funcao aqui e mudar AI_PROVIDER no .env.
 *
 * Hoje: 'gemini' (free tier do Google AI Studio) ou 'none' (so copiar/colar).
 */

// Lido a cada chamada, nao no topo: os imports rodam antes de o index.js
// carregar o .env, entao uma const aqui nasceria sempre com o valor padrao.
const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** Qual provedor esta ligado agora. 'none' quando falta a chave. */
export function provider() {
  const wanted = process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'none');
  if (wanted === 'gemini' && !process.env.GEMINI_API_KEY) return 'none';
  return wanted;
}

export const isEnabled = () => provider() !== 'none';

/** Estado atual, para a interface explicar o que esta disponivel. */
export function describe() {
  const name = provider();
  if (name === 'gemini') return { provider: 'gemini', model: geminiModel(), enabled: true };
  return {
    provider: 'none',
    enabled: false,
    reason: 'Nenhuma chave de IA configurada. Defina GEMINI_API_KEY no .env para ligar a geração automática.',
  };
}

export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/** A resposta da Interactions API traz o texto espalhado em steps[].content[]. */
function extractText(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  return steps
    .filter((s) => s?.type === 'model_output')
    .flatMap((s) => (Array.isArray(s.content) ? s.content : []))
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('')
    .trim();
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Sobrecarga do lado do Google e comum no free tier e passa sozinha. */
const isOverloaded = (status, detail) =>
  status === 503 || status === 500 || /high demand|overloaded|unavailable/i.test(detail || '');

async function generateWithGemini(prompt, { signal, parts = [], attempt = 0 } = {}) {
  // input aceita string simples ou array de partes; so monta o array quando
  // ha anexo, para a chamada sem arquivo ficar igual a de antes.
  const input = parts.length ? [...parts, { type: 'text', text: prompt }] : prompt;
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({ model: geminiModel(), input }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const detail = data?.error?.message || `HTTP ${res.status}`;

    // Ate 2 novas tentativas, espacadas, antes de desistir.
    if (isOverloaded(res.status, detail) && attempt < 2) {
      await sleep([2000, 6000][attempt]);
      return generateWithGemini(prompt, { signal, parts, attempt: attempt + 1 });
    }
    if (isOverloaded(res.status, detail)) {
      throw new AiError('O Gemini está sobrecarregado agora. Tente de novo em alguns minutos.', 503);
    }
    // 429 e o caso mais comum no free tier; vale uma mensagem propria.
    if (res.status === 429) {
      throw new AiError('Limite do plano gratuito do Gemini atingido. Tente de novo mais tarde.', 429);
    }
    if (res.status === 413) {
      throw new AiError('Os anexos somados passaram do limite da API. Remova alguns arquivos.', 413);
    }
    if (res.status === 400 || res.status === 403) {
      throw new AiError(`O Gemini recusou a chamada: ${detail}`, 502);
    }
    throw new AiError(`Falha ao falar com o Gemini: ${detail}`);
  }

  const text = extractText(data);
  if (!text) throw new AiError('O Gemini devolveu uma resposta vazia.');
  return text;
}

/**
 * Gera texto a partir do prompt. Lanca AiError (com .status) quando falha,
 * para a rota devolver o codigo certo em vez de um 500 generico.
 */
export async function generate(prompt, opts = {}) {
  switch (provider()) {
    case 'gemini':
      return generateWithGemini(prompt, opts);
    default:
      throw new AiError(describe().reason, 503);
  }
}
