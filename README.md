# Painel de Consultas (versão simples, gratuita, multiusuário)

Painel para registrar atendimentos (Adulto, Pediatria, One e Plantão com preço
escalonado), acompanhar faturamento do dia/mês e metas. Cada pessoa tem login
próprio e os dados ficam salvos "na nuvem" (Netlify Blobs) — acessíveis de
qualquer dispositivo.

## O que foi tirado em relação à ideia original
Para simplificar, este painel **não tem**: cobrança/assinatura, painel de
administrador, comparação entre contas, chat de suporte, escala de plantão
compartilhada entre médicos, exportação em PDF, controle de pausas/tempo ativo,
"Atendimentos/hora líquida", "Estimativa no fim da jornada" e "Tempos do dia".
Ele tem apenas o essencial: registro por tipo, plantão com preço escalonado
por horário, métricas do dia, calendário com meta do mês e gráficos de
semana/mês.

## Como o Plantão é calculado
O sistema detecta automaticamente a faixa pelo horário do registro e cobra em
degraus (a contagem reinicia a cada dia):

- **M** (07:00–13:00): 30 primeiros por R$ 20, depois R$ 15
- **T** (13:00–19:00): 30 primeiros por R$ 20, depois R$ 15
- **Reforço** (19:00–00:00): 25 primeiros por R$ 20, depois R$ 15
- **Noturno** (00:00–07:00): 25 primeiros por R$ 28, depois R$ 15

Para mudar esses valores, edite o objeto `SHIFT_PRICING` no início do
`app.js` (linha ~14) e, se quiser manter os dois lados consistentes, replique
a mesma lógica em `netlify/functions/api.js` só é necessário se você mover o
cálculo para o servidor — hoje ele roda no navegador de cada usuário.

## Deploy no Netlify

1. **Crie um repositório Git** (GitHub/GitLab/Bitbucket) com todos esses
   arquivos, ou simplesmente arraste a pasta inteira no painel do Netlify
   ("Deploys" → "Deploy manually") — funciona também sem Git.
2. No Netlify, crie um novo site a partir desse repositório/pasta.
   - Build command: `npm install` (já configurado em `netlify.toml`)
   - Publish directory: `.` (raiz)
   - Functions directory: `netlify/functions` (já configurado)
3. **Ative o Netlify Blobs**: sites criados nas contas atuais do Netlify já
   vêm com Blobs disponível automaticamente para as Functions — não precisa
   criar nada manualmente.
4. **Defina a variável de ambiente** `JWT_SECRET`:
   - Site settings → Environment variables → Add a variable
   - Nome: `JWT_SECRET` / Valor: qualquer texto longo e aleatório (ex.: gere
     com `openssl rand -hex 32`)
   - Sem essa variável a API responde erro 500 de propósito, para não rodar
     sem segredo de sessão.
5. Clique em **Deploy site**. O Netlify instala as dependências
   (`@netlify/blobs`, `bcryptjs`, `jsonwebtoken`) e publica automaticamente em
   um endereço `algo.netlify.app` (dá para trocar o subdomínio em Site
   settings → Domain management).

## Uso
- Cada pessoa do grupo cria a própria conta em "Cadastre-se" (e-mail + senha,
  mínimo 8 caracteres) e depois faz login.
- Como é de uso restrito a um grupo seleto, não há confirmação de e-mail nem
  recuperação de senha automática — se alguém esquecer a senha, é preciso
  apagar e recriar o registro dela diretamente no Netlify Blobs (via Netlify
  CLI) ou você pode adicionar esse fluxo depois.
- Os dados de cada usuário ficam isolados: ninguém vê o painel de outra
  pessoa.

## Rodar localmente (opcional)
Com a [Netlify CLI](https://docs.netlify.com/cli/get-started/) instalada:

```bash
npm install
netlify dev
```

Isso sobe o site e as functions juntos em `http://localhost:8888`, com Blobs
emulado localmente. Observação: cookies `Secure` só funcionam em HTTPS — em
`localhost` alguns navegadores ainda aceitam por ser ambiente de
desenvolvimento, mas se tiver problema de login local, remova
temporariamente `Secure;` das duas funções `makeCookie`/`clearCookie` em
`netlify/functions/api.js` só para testar localmente (não remova em
produção).

## Navegação (Atendimentos | Escala | Agenda | Emprego 2)
O menu superior só mostra/oculta áreas que já existem na mesma página (nada é
duplicado). A área de Atendimentos não teve lógica alterada. A Agenda mostra
plantões (Escala/atendimentos), Emprego 2 e compromissos próprios; o Emprego 2
guarda horas e valores. Em **Configurações → Segurança e backup** aparece a data
do último backup automático (rota somente leitura `GET /api/backup/info`).
