/**
 * Envio de e-mail (hoje so os convites). Usa SMTP configurado no .env; sem
 * configuracao o app segue funcionando e a interface entrega o link do convite
 * para ser enviado a mao.
 *
 * As variaveis sao lidas a cada chamada, nao no topo: os imports rodam antes
 * de o index.js carregar o .env.
 */
import nodemailer from 'nodemailer';

const env = (name) => (process.env[name] || '').trim();

export const isMailEnabled = () => Boolean(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS'));

let cached = null;
let cachedKey = '';

function transport() {
  const port = Number(env('SMTP_PORT')) || 587;
  const key = [env('SMTP_HOST'), port, env('SMTP_USER'), env('SMTP_PASS')].join('|');
  if (!cached || key !== cachedKey) {
    cached = nodemailer.createTransport({
      host: env('SMTP_HOST'),
      port,
      // 465 = TLS direto; 587 = STARTTLS. SMTP_SECURE=true forca o primeiro.
      secure: env('SMTP_SECURE') ? env('SMTP_SECURE') === 'true' : port === 465,
      auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    });
    cachedKey = key;
  }
  return cached;
}

const escapeHtml = (v) => String(v ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function sendInviteEmail({ to, link, inviterName, positionName, expiresAt }) {
  const from = env('SMTP_FROM') || env('SMTP_USER');
  const until = new Date(expiresAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
  const role = positionName ? ` como ${positionName}` : '';

  await transport().sendMail({
    from,
    to,
    subject: `${inviterName} convidou você para a Lousa`,
    text: [
      `${inviterName} convidou você para participar da Lousa${role}, o quadro do semestre da turma.`,
      '',
      `Crie sua conta por este link (vale até ${until}, uso único):`,
      link,
      '',
      'Se você não esperava este convite, é só ignorar este e-mail.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#171717;max-width:480px">
        <p><strong>${escapeHtml(inviterName)}</strong> convidou você para participar da
        <strong>Lousa</strong>${escapeHtml(role)}, o quadro do semestre da turma.</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(link)}" style="background:#171717;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">
            Criar minha conta</a>
        </p>
        <p style="color:#666;font-size:13px">O link vale até ${escapeHtml(until)} e só pode ser usado uma vez.<br>
        Se o botão não abrir, copie: ${escapeHtml(link)}</p>
        <p style="color:#666;font-size:13px">Se você não esperava este convite, é só ignorar este e-mail.</p>
      </div>`,
  });
}
