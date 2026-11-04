# Vercel + Neon/PostgreSQL

O painel usa Node 24 na Vercel, região `gru1`. A interface e os ícones de `public/`
permanecem preservados. `api/index.mjs` e `src/vercel.mjs` adaptam a entrada para
reutilizar as regras de `src/worker.mjs`, com cookies, CSP e validação de origem.
O limite por IP usa `x-vercel-forwarded-for`, definido pela plataforma.

`src/postgres.mjs` implementa persistência Neon. Cada lote é transacional.
Leituras de estado/revisão usam um snapshot `REPEATABLE READ`; escritas preservam
revisão otimista, rollback, recibos idempotentes e índices únicos de JSON.
`migrations/postgres/0001_core.sql` é a migration PostgreSQL. Não use a migration
SQLite nesse banco. Configurar a conexão não importa dados antigos do D1.

## Preparar e publicar

Reutilize `big-operacao`, projeto `prj_2uBl1vkikFTgzAg0DwfTWBsSGzWd`, equipe
`team_dZlw0XSD1Tl5Z4gE3kUxXVS6` (`ronald-almeida-4717s-projects`).

1. Conecte o Neon e habilite banco/branch separado para Preview.
2. Configure `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `APP_ORIGIN`, `VAULT_KEY`
   (32 bytes aleatórios em hexadecimal), `BOOTSTRAP_TOKEN` e `CRON_SECRET`
   (pelo menos 32 caracteres aleatórios). Use chaves diferentes por ambiente.
   Guarde a chave do cofre separada do banco e preserve-a entre deploys.
3. Execute `npm ci`, `npm run check`, `npm test`. Para testar as regras originais
   sobre PostgreSQL local, defina `TEST_DATABASE=postgres` e execute
   `node --test tests/core.test.mjs tests/farm-publish.test.mjs`.
4. Publique um Preview. O build aplica migrations com lock e checksum e testa o
   Neon real em schemas temporários exclusivos, removidos ao terminar.
   A origem de Preview é a URL exclusiva do deployment, `VERCEL_URL`.
5. Valide navegador e API e publique o mesmo commit em Production. O build de
   produção aplica migrations e não cria contas demonstrativas.
6. Abra `APP_ORIGIN` e crie o primeiro administrador com o código de setup.
   Remova `BOOTSTRAP_TOKEN` após o primeiro acesso. A API também bloqueia
   permanentemente uma segunda configuração.

## Serviço público da Farm

O Worker separado `src/farm-public.mjs` lê diretamente a view
`public_farm_sites` no mesmo PostgreSQL. A view contém somente versões publicadas
em domínios ativos. Editar rascunho não altera o site ao vivo.

1. Crie uma conta restrita seguindo `migrations/postgres/farm-reader.example.sql`,
   usando senha nova. Confirme que pode ler a view e não pode consultar
   `records` ou `auth_sessions`.
2. No Worker `big-operacao-farm`, configure `FARM_DATABASE_URL` dessa conta,
   `APP_ORIGIN` e o mesmo `CRON_SECRET` de produção. Não instale a chave do
   cofre, o código de setup ou a conexão administrativa nesse serviço.
3. Publique com `npm run deploy:farm` usando `wrangler.farm.json`.
4. Na Vercel, configure `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` restrito
   às zonas autorizadas e `FARM_WORKER_SERVICE=big-operacao-farm`.
5. Publique em uma zona ativa. HTTPS só fica confirmado depois de consultar
   realmente `https://HOST/__farm-check`. DNS/bindings de outros serviços são
   preservados. Substituir raiz exige confirmação.

Só `/` e `/__farm-check` atendem nos hosts públicos. Não há painel, API
administrativa, sessões ou credenciais nesse serviço.

## Agendamento

`/api/cron` exige `Authorization: Bearer CRON_SECRET`. A Vercel executa limpeza
diária às 06:00 UTC, compatível com Hobby. O Worker da Farm chama esse endpoint
a cada 5 minutos. Antes de conectar o Worker, as telas calculam presença com o
relógio do servidor e as operações consolidam períodos vencidos; a manutenção
periódica ocorre diariamente. Se não usar o Worker, configure um agendador
autenticado de 5 minutos ou frequência equivalente em um plano Vercel compatível.

## Backup e recuperação

Com conexão direta configurada em ambiente seguro:

```sh
node scripts/backup-postgres.mjs /local-seguro/backup.json
```

O backup contém dados privados e credenciais cifradas. Criptografe o arquivo no
destino seguro e mantenha a `VAULT_KEY` em outro local. Inclui registros, revisão
e recibos; não inclui sessões de login nem limites temporários.

Restaure primeiro em outro banco vazio com migrations aplicadas. Defina a chave
original separadamente, `RESTORE_EMPTY_DATABASE=yes`, e execute:

```sh
node scripts/restore-postgres.mjs /local-seguro/backup.json
```

O script verifica checksum, testa a chave antes de escrever e recusa destinos
com dados. A restauração é transacional. Dados reais de D1 exigem exportação e
ensaio de importação em separado antes da troca de produção.
