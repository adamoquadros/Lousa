/**
 * Funcao da Vercel. Todas as rotas /api/* (e o CSS de tokens) chegam aqui pelo
 * vercel.json e o app Express responde. As paginas de public/ a Vercel entrega
 * direto, sem passar por aqui.
 */
export { default } from '../server/app.js';
