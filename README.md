# Lousa

> O semestre da turma: matérias, prazos, responsáveis e resumos em um quadro só.

Ferramenta local para organizar as rotinas da faculdade em equipe: semestres, matérias,
professores, dias de aula, tarefas com prazo e responsáveis, e resumos por matéria.

## Como rodar

```bash
npm install     # só na primeira vez
npm start       # http://localhost:4000
```

O banco de dados é um **Postgres no Neon** (na nuvem). Antes do primeiro `npm start`, copie o
`.env.example` para `.env` e preencha `DATABASE_URL` com a conexão do painel do Neon
(*Connect*, a URL com `-pooler` no host). As tabelas são criadas sozinhas na primeira execução.
Sem `DATABASE_URL` o servidor não sobe e avisa o que falta.

Durante o desenvolvimento, `npm run dev` reinicia o servidor a cada alteração.

Na primeira abertura o app pede a criação da **conta de administrador** — essa primeira conta
é a sua. Depois, em **Equipe**, você cadastra o resto do pessoal com e-mail e senha.

## Como está organizado

```
DESIGN.md           referência de estilo do design system (v0 by Vercel)
DESIGN-NOTES.md     como ele foi aplicado e os desvios deliberados
variables.css       tokens em CSS — servidos em /css/variables.css
tokens.json         os mesmos tokens em JSON
theme.css           bloco @theme do Tailwind v4 (não usado: o app é CSS puro)
server/
  index.js          servidor Express e arquivos estáticos
  app.js            o app Express (usado pelo npm start e pela Vercel)
  index.js          liga o app numa porta, para rodar no computador
  db.js             conexão com o Postgres (pg), schema e helpers all/get/run/tx
  storage.js        conteúdo dos anexos e imagens, guardado no banco (tabela blobs)
  auth.js           hash de senha (scrypt), sessões por cookie e regras de permissão
  routes/
    auth.js         primeira conta, login, logout, senha, lista da equipe
    users.js        gestão de contas (só admin)
    positions.js    cargos da equipe (leitura para todos, alteração só admin)
    invites.js      convites por e-mail (criar/reenviar/cancelar: admin; aceitar: público)
  mailer.js         envio de e-mail via SMTP (nodemailer), configurado no .env
    subject-images.js  imagem do cartão e fundo do modal de cada matéria
    api.js          semestres, matérias, aulas, tarefas, resumos, panorama
public/
  index.html
  css/styles.css    componentes montados sobre os tokens do design system
  js/api.js         cliente HTTP
  js/ui.js          datas, modais, toasts, escape de HTML
  js/modals.js      modal da matéria (abas) e formulários
  js/app.js         estado, views (Visão geral, Matérias, Tarefas, Agenda, Equipe)
scripts/
  migrate-sqlite-to-postgres.js  copia o banco antigo (data/app.db) para o Postgres
api/index.js        função da Vercel: entrega as rotas /api ao app Express
vercel.json         rotas da Vercel (/api e o CSS de tokens vão para a função)
```

## Perfis de acesso

Os perfis são editáveis em **Perfis e acesso** (menu lateral). Cada perfil tem um **nível** na
hierarquia (quanto menor, mais alto) e uma lista de **direitos**:

| Área | Direitos |
| --- | --- |
| Semestres | criar · editar e excluir |
| Matérias | criar e editar (inclusive imagens) · excluir as de outras pessoas |
| Tarefas | criar e editar, prazos e responsáveis · excluir as de outras pessoas |
| Resumos e material | criar resumos e anexar · editar/excluir os de outras pessoas · gerar com IA |
| Equipe | convidar · criar, editar e remover contas · gerenciar cargos e funções · gerenciar perfis |

Regras da hierarquia (o servidor confere todas):

- Quem gerencia contas, convites ou perfis só mexe no que está **abaixo** do seu nível, e só
  concede perfis abaixo do seu.
- Ninguém concede um direito que o próprio perfil não tem, e ninguém muda o próprio perfil.
- O perfil **Administrador** (nível 0) tem todos os direitos, não pode ser alterado nem excluído, e o
  app não deixa rebaixar o último administrador. **Membro** (nível 10) é o padrão de quem entra.
- Editar e excluir o que a própria pessoa criou é sempre permitido.

A coluna antiga `users.role` (admin/member) continua sendo preenchida, por compatibilidade.

## Telas

- **Visão geral** (inicial): o seletor de semestre, o painel do semestre (matérias, tarefas
  abertas, atrasadas, próximos 7 dias), a tabela de **integrantes** — cargo, entregas a fazer,
  em andamento, atrasadas, que vencem em 7 dias, concluídas e a próxima entrega de cada um
  (clicar na linha abre as tarefas da pessoa) — e a lista das matérias do semestre.
- **Matérias**: os cartões das matérias, com a imagem de capa de cada uma, e o próprio seletor
  de semestre. Clicar no cartão (ou na linha da lista da Visão geral) abre o modal com as abas
  **Informações**, **Tarefas**, **Resumos** e **Datas**; o botão **Editar** (no cartão, na linha
  ou no topo do modal) altera os dados da matéria.
- **Imagens da matéria**: no formulário da matéria dá para escolher uma imagem para o cartão e
  outra para o fundo atrás do modal aberto (PNG, JPG ou WEBP, até 4MB). Os arquivos ficam no
  banco e são apagados junto com a matéria.
- **Tarefas**: lista de tudo do semestre, com busca e filtros por matéria, situação e responsável.
  Marcar como concluída é um clique na caixa à esquerda.
- **Agenda**: grade da semana com as aulas de cada matéria e os próximos prazos.
- **Equipe**: quem participa e o cargo de cada um. Admin adiciona, edita e remove pessoas, cria,
  renomeia e exclui **cargos** (Líder, Revisor...) e atribui um cargo a cada integrante — dá para
  criar o cargo na hora, pelo próprio cadastro da pessoa. O cargo é só um rótulo: o que a pessoa
  pode fazer continua vindo do perfil (admin/membro).

O seletor de semestre fica na Visão geral e na aba Matérias: cada semestre guarda o próprio
conjunto de matérias.

Clicar no próprio nome, no canto superior direito, abre o menu da conta: **Editar perfil**
(nome, e-mail, cor), **Alterar senha**, **Convidar participante** (admin) e **Sair**.

## Material e prompts de estudo

Na aba **Resumos** de cada matéria ficam os anexos (PDFs e fotos de slides ou do quadro, até 4MB)
e a geração. O **Tipo de resumo** é uma lista suspensa com busca: resumo para prova, para estudos,
revisão de véspera, fichamento, glossário, mapa mental, flashcards, questões de múltipla escolha,
questões discursivas, roteiro de apresentação e slides. A busca acha qualquer palavra em qualquer
parte do nome ou da descrição, sem ligar para acento ("prova" traz todos que falam em prova).

- **Leitura automática:** ao anexar, o app lê o conteúdo. PDF com texto é lido direto, página por
  página e sem IA; foto e PDF escaneado são transcritos pelo Gemini (precisa de `GEMINI_API_KEY`;
  sem ela, ficam como "precisa da IA" e podem ser relidos depois em **Ler de novo**).
  O texto fica guardado no anexo; **Ver texto** mostra o que foi lido.
- **O prompt leva o material:** o texto dos anexos marcados entra no prompt, com a página de
  origem (`[p. 4]`), até ~60 mil caracteres. O que passar disso é cortado e avisado.
- **Foco** (opcional): uma linha para dizer o que priorizar ("só a unidade 2", "Dejours e Clot").
- **Fontes:** o prompt pede que cada tópico cite de onde veio, no formato (arquivo, p. N), e marque
  (fora do material) o que vier de fora.
- O prompt usa só o que muda o conteúdo: nome da matéria, observações/ementa, avaliações em
  aberto e títulos dos resumos já feitos. Professor, sala, dias de aula e datas ficam de fora.
- Um medidor mostra quanto do material marcado cabe no prompt (~60 mil caracteres) antes de gerar.
- Com chave de IA, **Gerar e salvar** gera e salva o resumo sozinho. **Ver prompt** (sempre
  disponível) abre o prompt editável, com **Copiar** e **Abrir no Claude / ChatGPT / Gemini**:
  o botão do chat copia o prompt e abre a conversa; se o prompt for curto, já chega preenchido
  (o Gemini não aceita isso pelo link, então lá é só colar).

## Convites

Admin convida pelo menu da conta ou em **Equipe → Convidar participante**, informando e-mail,
cargo e perfil. A pessoa recebe um link de uso único (vale 7 dias), escolhe nome e senha e a
conta nasce com o cargo e o perfil do convite. Em Equipe ficam os convites pendentes, com
**Reenviar** (gera um link novo e invalida o anterior) e **Cancelar**.

Para o e-mail sair sozinho, preencha no `.env` (modelo em `.env.example`):

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — com Gmail, use uma
  [senha de app](https://myaccount.google.com/apppasswords), não a senha normal.
- `APP_URL` — o endereço que o **convidado** vai abrir. `localhost` só funciona no seu
  computador; use o IP da máquina na rede (ex.: `http://192.168.0.10:4000`) ou um endereço público.

Sem SMTP o convite é criado do mesmo jeito e o app mostra o link para copiar e enviar à mão.
Depois de mudar o `.env`, reinicie o servidor.

## Design system

A interface segue o sistema em `DESIGN.md` + `variables.css` (v0 by Vercel):
paleta acromática, Geist, CTA em Ink, raios 8/12/9999, sombras só em cards e
modais. `public/css/styles.css` não redefine tokens — ele mapeia os tokens para
os papéis da interface.

A marca é um quadro com o "L" vazado em giz, que se inverte sozinho entre os
temas. No hover, cartões e linhas sobem e acendem na cor da própria matéria, e
o item do menu inverte fundo e texto.

`DESIGN-NOTES.md` detalha a marca, os efeitos e os três desvios deliberados em
relação ao sistema.

## Escala visual (simetria)

Nenhum componente muda de tamanho conforme o conteúdo. Todas as medidas ficam em
variáveis CSS no topo de `public/css/styles.css` — mexer em uma delas ajusta a
ferramenta inteira:

| Variável | Valor | Onde se aplica |
| --- | --- | --- |
| `--card-h` | 196px | cartão de matéria e o cartão "Nova matéria" |
| `--tile-h` | 96px | tiles do painel (matérias, tarefas abertas, atrasadas…) |
| `--row-h` | 104px | linha de tarefa, em qualquer tela |
| `--day-h` | 288px | coluna de dia na agenda |
| `--class-h` | 68px | bloco de aula |
| `--note-h` | 196px | cartão de resumo fechado |
| `--tr-h` | 60px | linha de tabela |
| `--empty-h` | 220px | estado vazio |
| `--modal-w` / `--modal-h` | 720 × 640px | todas as janelas, menos confirmações |
| `--control-h` / `--control-sm-h` | 40px / 32px | botões, campos, itens de menu |
| `--filter-w` | 196px | cada controle da barra de filtros |

As alturas acompanham a escala tipográfica do design system — se a tipografia
mudar, estes são os números a reajustar.

As regras que sustentam isso:

- Cada faixa de um cartão tem altura reservada mesmo vazia (o código da matéria,
  por exemplo), então os títulos alinham entre cartões.
- Texto que não cabe é cortado com reticências — duas linhas no nome da matéria,
  uma linha em professor, título e descrição de tarefa, três linhas no resumo.
- As etiquetas ficam ancoradas na base do cartão e limitadas a duas, para caberem
  sempre em uma linha.
- Resumo longo ganha o botão **Ver mais**, que é a única coisa que expande um
  bloco — e só sob clique.
- A grade usa `grid-auto-rows: var(--card-h)`. Com `1fr`, um nome comprido
  esticava todos os cartões da página.

## Publicar na Vercel

O projeto já vem pronto para a Vercel (`vercel.json` + `api/index.js`): as páginas de `public/`
são servidas direto e as rotas `/api` rodam como função. Basta conectar o repositório do GitHub
e, em **Settings → Environment Variables**, definir `DATABASE_URL` (a integração do Neon já cria
essa variável). Opcionais: `GEMINI_API_KEY`, `SMTP_*` e `APP_URL`. Cada `git push` na `main`
publica uma versão nova.

## Notas técnicas

- Banco: Postgres (Neon) via `pg`. As rotas escrevem SQL com `?`, que `db.js` converte para
  `$1, $2...`; todas as consultas são assíncronas. Datas (`DATE`) voltam como `'AAAA-MM-DD'` e
  horários (`TIMESTAMPTZ`) como texto ISO. "Hoje" nos painéis usa o fuso de São Paulo.
- Senhas com `scrypt` e sal por usuário; sessão em cookie `httpOnly` com validade de 30 dias.
- Todo dado vindo do usuário passa por `esc()` antes de virar HTML.
- Tudo fica no Neon, inclusive o conteúdo dos anexos e das imagens (tabela `blobs`): na Vercel o
  disco é descartável. Limite de 4MB por arquivo, um arquivo por envio — a Vercel recusa
  requisições acima de ~4,5MB.
- Migração do SQLite antigo: `npm run migrate:sqlite` (só roda com o Postgres vazio; não altera
  o `data/app.db`, que fica como cópia de segurança).
- Para a turma acessar pela rede local, rode `set PORT=4000` e libere a porta no firewall;
  o servidor já escuta em todas as interfaces.

## Próximos passos possíveis

- Anexos e links nos resumos, e formatação Markdown
- Notificação de prazos próximos (e-mail ou push)
- Histórico de alterações por tarefa
- Exportar o semestre (PDF ou calendário .ics)
