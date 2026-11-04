# Big Operação

Gestão de perfis, BMs, equipe, jornada, custos, vendas e sites de empresas. Interface em português, com o visual e os ícones do protótipo aprovado. Esta aplicação usa **Cloudflare Workers + D1**. O GitHub guarda o código; GitHub Pages não executa este backend.

## Situação da entrega

Código de servidor e interface integrados, sem contas fictícias, sem login de demonstração e sem registros operacionais em localStorage. A infraestrutura de produção ainda deve ser conectada: conta Cloudflare, D1, endereço do painel e segredos. Um commit no GitHub, sozinho, não coloca a aplicação em produção.

### Funcionalidades

- Administrador inicial protegido por um código de configuração. Contas individuais dos funcionários, desativação de acesso, troca de senha e sessões de 12 horas em cookie HttpOnly.
- Permissões verificadas no servidor em cada operação. Funcionários acessam seus perfis, BMs, tarefas e sites; vendas, custos e visão completa da equipe são do administrador.
- Credenciais de perfis criptografadas com AES-256-GCM. Consulta e alteração com histórico. Senhas de login usam scrypt, nunca são recuperáveis.
- Jornada pelo relógio do servidor, pausas, confirmação de presença, timeout e ajustes administrativos com preservação do valor original. A confirmação expira mesmo com o navegador fechado. Cron consolida os registros a cada cinco minutos; leituras e comandos também aplicam os prazos.
- Referência mensal e horas previstas por funcionário. Horas/valor normais limitados à meta no painel do funcionário. Administrador vê horas reais, extras e valor adicional. Tarifa de extra em branco deixa a estimativa parcial. Nenhum pagamento bancário é executado.
- Faixas de BM: 250, 2K, 10K, 100K e ilimitado. Estoque e situação separados; uma venda por BM, com atualização atômica e custo direto congelado.
- Proxies por nome, mensalidade e renovação. Custos e rateio estimado de mão de obra nas BMs.
- Farm com 20 modelos, consulta de CNPJ no servidor, domínio raiz/subdomínio, capacidade, rascunhos, versões publicadas, exportação e publicação Cloudflare opcional. O domínio precisa pertencer à conta conectada e ter zona ativa. Publicações só indicam HTTPS confirmado após verificação real.

## Instalação local

Requer Node.js 24 e npm. Wrangler está fixado no lockfile.

```sh
npm ci
npm run db:local
```

Crie `.dev.vars` (ignorado pelo Git) com `APP_ORIGIN="http://localhost:8787"`, um `VAULT_KEY` de 64 caracteres hexadecimais aleatórios e um `BOOTSTRAP_TOKEN` aleatório de pelo menos 32 caracteres. Gere valores novos, não use credenciais dos testes. Depois execute `npm run dev` e abra o endereço configurado. Dados locais do Wrangler nunca são enviados à produção.

```sh
npm run check
npm test
npx wrangler deploy --dry-run
```

## Primeira publicação

1. Na Cloudflare, habilite Workers e crie um banco D1 chamado `big-operacao`. A configuração de CPU usa o plano Workers Paid. Anote o **Account ID**, **Database ID** e o endereço `https://big-operacao.SEUSUBDOMINIO.workers.dev` (ou conecte um domínio próprio ao Worker).
2. Crie um token Cloudflare restrito à conta para deploy, com permissões de edição de Workers Scripts e D1. Guarde-o em um gerenciador de segredos. Não coloque tokens no código ou em mensagens/commits públicos.
3. No ambiente de execução, defina `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` e `APP_ORIGIN`. `APP_ORIGIN` é a origem HTTPS exata, sem barra final nem caminho. O script gera `wrangler.generated.json`, ignorado pelo Git; o arquivo contém IDs, não tokens.
4. Execute `npm run deploy`. O script valida o projeto, aplica as migrations remotas e publica. Neste momento o acesso continua bloqueado até a configuração dos segredos.
5. Execute `npm run setup`. Ele verifica se já existem chaves antes de gerar e instalar `VAULT_KEY` e `BOOTSTRAP_TOKEN`. Os valores são salvos **apenas** em `.env.production-secrets`, com permissões restritas e ignorado pelo Git. Guarde uma cópia segura: perder `VAULT_KEY` torna as senhas dos perfis irrecuperáveis. O script se recusa a sobrescrever chaves existentes.
6. Abra `APP_ORIGIN`, crie seu administrador usando o código e uma senha própria e faça login. Remova `BOOTSTRAP_TOKEN` dos secrets do Worker após concluir o primeiro acesso. O endpoint também se bloqueia permanentemente após a criação do administrador.
7. Cadastre os funcionários e as referências de remuneração. Faça o teste completo com um funcionário, incluindo entrada, pausa, retorno, entrega, encerramento e conferência no administrador.

### Publicações seguintes pelo GitHub

Em **Settings → Secrets and variables → Actions**, configure o secret `CLOUDFLARE_API_TOKEN` e as variables `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` e `APP_ORIGIN`. Configure o environment `production` conforme sua política.

Execute **Actions → Publicar Cloudflare → Run workflow** na branch `main`. O workflow é manual e serializado para evitar deploys simultâneos. Ele roda as verificações e aplica migrations antes de publicar. Não configura nem altera a chave do cofre.

## Conectar a publicação da Farm

Os rascunhos e consultas funcionam sem token Cloudflare no Worker. Para publicar sites:

- Adicione a zona do domínio à mesma conta Cloudflare e ajuste os nameservers no registrador. Aguarde status ativo.
- Instale o secret **CLOUDFLARE_API_TOKEN no Worker**, separado do token de CI. O token de runtime precisa de leitura de zona/DNS e edição dos Custom Domains/Workers na conta destinada à Farm. Restrinja o acesso às zonas necessárias. `CLOUDFLARE_ACCOUNT_ID` e `FARM_WORKER_SERVICE=big-operacao` já são variáveis de runtime.
- Cadastre o domínio no painel e publique um site autorizado. Registros DNS ou bindings pertencentes a outro serviço são preservados; endereços em conflito são recusados.
- Se a emissão de HTTPS não terminar na primeira tentativa, use **Verificar HTTPS**. A troca de um site na raiz exige confirmação. Mudança de endereço e exclusão de site publicado exigem **Retirar publicação** antes.
- O painel administrativo e os sites públicos usam hosts diferentes. Os hosts públicos nunca atendem a API administrativa nem recebem o cookie de login do painel. HEAD personalizado só é executado no site público; a prévia interna é isolada.

O limite de sites do cadastro não altera as cotas da Cloudflare. A aplicação não compra domínios nem cria novas zonas automaticamente. Consulta de CNPJ depende da disponibilidade das bases públicas; preenchimento manual continua disponível.

## Operação e recuperação

- D1 mantém os registros separados por entidade. Escritas usam transações com revisão otimista, proteção contra repetição e índices únicos. Auditoria e jornada ficam no banco, não no dispositivo.
- Habilite alertas e acompanhe erros, consumo de CPU, D1 e falhas de publicação no painel Cloudflare. Não registre senhas, tokens, corpos de login ou credenciais em logs.
- Confirme a retenção de Time Travel do plano contratado. Faça exportações periódicas criptografadas do D1 para um local seguro e teste a restauração em **outro banco**. Exportações incluem hashes de acesso e credenciais cifradas; nunca as envie a este repositório público.
- O backup do banco e o backup da chave `VAULT_KEY` são ambos necessários para recuperar o cofre. Preserve a chave durante deploys. Rotação exige migração/recriptografia, não substituição direta.
- Migrations aplicadas são imutáveis. Adicione novos arquivos SQL; não edite os já executados. Um rollback de código não desfaz automaticamente uma migration.
- Referências salariais são mensais e seu histórico de alteração é preservado. Relatórios são estimativas operacionais; esta versão não contém fechamento de folha, encargos, transferência de pagamentos nem integração com sistema oficial de ponto.
- A versão inicial lê o conjunto da operação para os cálculos e usa uma revisão global de escrita. Para grandes volumes/equipes, evolua para consultas paginadas e agregações por período antes de ampliar a carga. Valide o desempenho com o volume real da sua operação.
- Não há importação automática dos dados fictícios do protótipo. O banco de produção começa vazio.

## Origem e verificação

Modelos, renderizador, validação/consulta de CNPJ e adaptador Cloudflare da Farm derivados de [ronald-almeida/big-cloack](https://github.com/ronald-almeida/big-cloack), commit `22593ebf67a91c7ff470cf20783f12aa9d1d39f7`. O módulo foi adaptado a autenticação, permissões, armazenamento e publicação do Big Operação. Não foi incorporado o sistema de cloaking.

Testes cobrem autenticação/CSRF, isolamento de funcionários, criptografia, desativação de conta, atualização de senha, idempotência, concorrência, venda única, horas extras, virada de mês, presença, capacidade da Farm e separação de hosts. Chamadas aos provedores são simuladas nos testes. A publicação real e o DNS dependem da conta Cloudflare e precisam de validação após conectar o ambiente.

Documentação de infraestrutura: [Workers](https://developers.cloudflare.com/workers/), [D1](https://developers.cloudflare.com/d1/), [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
