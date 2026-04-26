# Auditoria V2 da aplicacao VigiaEscolar

## Objetivo

Identificar gaps, desalinhamentos e fluxos confusos da aplicacao atual para orientar uma versao 2.0 mais consistente, segura e operavel.

## Resumo executivo

A aplicacao evoluiu de um MVP visual para uma base real com API, autenticacao, banco, biometria e gateway de cameras. Porem, ainda ha desalinhamentos importantes entre contratos de frontend/backend, seguranca por perfil, persistencia, face server, notificacoes e operacao de cameras.

Os pontos mais criticos para a V2 sao:

- Corrigir autorizacao por papel antes de liberar app do responsavel.
- Unificar contratos de settings, camera, presenca, notificacao e biometria.
- Resolver o conflito de schema entre API principal e `ultrazend-face-server`.
- Tirar dados sensiveis e decisoes biometricas do frontend.
- Criar fluxos operacionais claros para camera, revisao, presenca e notificacao.
- Corrigir encoding/mojibake em textos e mensagens.

## Achados criticos

### A1 - Autorizacao por perfil quase inexistente

Impacto: alto.

Hoje as rotas usam `requireAuth`, mas quase nunca `requireRole`. Isso significa que um usuario autenticado no tenant pode acessar endpoints administrativos se tiver token valido.

Exemplos:

- `students`, `guardians`, `schools`, `cameras`, `settings` e `notifications` aceitam qualquer usuario autenticado.
- A pagina PWA filtra filhos no frontend, mas antes busca `listStudents`, `listResponsibles`, `listSchools` e `listCameraEvents`.
- Um responsavel autenticado pode receber dados que deveriam ser restritos ao admin/operador.

Direcao V2:

- Criar matriz de permissoes por role.
- Criar endpoints especificos para portal do responsavel.
- Aplicar `requireRole` e escopo por escola/responsavel.
- Evitar filtragem sensivel apenas no frontend.

### A2 - Contrato de configuracoes esta desalinhado

Impacto: alto.

O frontend trabalha com `entradaAluno`, `saidaAluno`, `analysisFps`, `dataRetentionDays` e `logRetentionDays`. O backend espera `notifyEntry`, `notifyExit`, `framesPerSecond`, `retention.recordingsDays` e `retention.logsDays`.

Como o Zod descarta chaves desconhecidas por padrao, grande parte das alteracoes da tela de configuracoes nao persiste.

Direcao V2:

- Criar DTO unico compartilhado ou mapper explicito no `updateSettings`.
- Validar no frontend e no backend com o mesmo shape.
- Adicionar teste de contrato para settings.

### A3 - `ultrazend-face-server` usa schema incompatível com a API principal

Impacto: alto.

O Compose aponta o Face Server para o mesmo banco da API principal. Porem a API principal usa `Tenant`, `User`, `School`, `Student`, `Guardian`, enquanto o Face Server espera tabelas mapeadas como `users`, `people`, `citizens` e `unidades_educacao`.

Direcao V2:

- Adaptar o Face Server ao schema do VigiaEscolar; ou
- Isolar o Face Server em schema/banco proprio e criar sincronizacao explicita.
- Definir IDs canonicos: aluno, responsavel, escola, camera, tenant.

### A4 - Modelo de camera mistura cadastro, fonte e operacao

Impacto: alto.

`Camera.status` representa status administrativo. A V2 tambem precisa de status operacional: `ONLINE`, `OFFLINE`, `DEGRADED`, `ERROR`.

A tabela `CameraRuntimeStatus` ja existe, mas o frontend ainda nao consome esse dado. Dashboard e telas ainda contam camera "online" usando `status === "Ativa"`.

Direcao V2:

- Expor runtime status em `CameraDTO`.
- Dashboard deve usar `CameraRuntimeStatus.healthStatus`.
- Diferenciar "camera ativa no cadastro" de "camera online no gateway".

### A5 - Reconhecimento ainda e dividido entre frontend, API e Face Server

Impacto: alto.

O fluxo atual tem tres caminhos: matching local no frontend, motor biometrico da API principal e `ultrazend-face-server` com outro modelo de dados.

Direcao V2:

- Definir o servidor como fonte de verdade.
- Frontend pode auxiliar captura, mas nao deve decidir presenca.
- Gateway deve enviar frame/snapshot para servico facial.
- API principal deve receber evento facial consolidado ou aprovado.

### A6 - Notificacoes nao possuem entrega real

Impacto: alto.

Eventos criam notificacoes `PENDING`, mas o endpoint de resend apenas marca como `SENT`. Nao ha provider, fila, retry real, webhook ou status de entrega.

Direcao V2:

- Criar `notification-worker`.
- Integrar provider WhatsApp/push real.
- Registrar tentativa, erro, provider message id e status.

### A7 - App do responsavel e uma simulacao dentro do painel admin

Impacto: medio/alto.

A pagina `/pwa` mostra uma moldura de celular dentro do dashboard autenticado. Ela nao e um portal real separado e depende de dados administrativos carregados no cliente.

Direcao V2:

- Criar area separada `/responsavel` ou app PWA real.
- Endpoint dedicado: `GET /api/guardian-portal`.
- Autorizacao `GUARDIAN` obrigatoria.

### A8 - Presenca manual marca `recognized: true`

Impacto: medio.

Ao alterar presenca manualmente, a rota `/presence/:studentId` grava `recognized: true`. Isso mistura presenca por reconhecimento facial com presenca manual.

Direcao V2:

- Adicionar origem da presenca: `MANUAL`, `FACE_RECOGNITION`, `IMPORT`, `ADMIN_ADJUSTMENT`.
- Manter `recognized` apenas para reconhecimento facial real.
- Auditar usuario que fez ajuste manual.

### A9 - Eventos desconhecidos podem ser perdidos na UI

Impacto: medio.

`camera-events` lista apenas `ENTRY` e `EXIT`. Eventos `UNKNOWN` sao persistidos, mas nao aparecem no fluxo principal de eventos.

Direcao V2:

- Criar fila de revisao para `UNKNOWN` e `REVIEW_REQUIRED`.
- Expor filtro por status de match.
- Exibir snapshots e decisao manual.

### A10 - Serializer de evento reduz tudo que nao e `ENTRY` para "Saiu"

Impacto: medio.

`toEventoCameraDTO` usa `event.type === "ENTRY" ? "Entrou" : "Saiu"`. Se um evento `UNKNOWN` chegar nesse serializer, ele vira "Saiu".

Direcao V2:

- Expandir DTO para `Entrou`, `Saiu`, `Desconhecido`, `Revisao`.
- Ajustar UI para estados nao binarios.

### A11 - Textos com mojibake/encoding misto

Impacto: medio.

Ha varios textos com caracteres corrompidos, por exemplo `CÃ¢mera`, `ResponsÃ¡vel`, `PresenÃ§a`, `â€”`.

Direcao V2:

- Normalizar arquivos para UTF-8.
- Rodar varredura por padroes `CÃ`, `Ã£`, `Ã§`, `â`.
- Adicionar checagem simples no CI para evitar regressao.

### A12 - Dados sensiveis de camera podem transitar demais

Impacto: medio/alto.

O endpoint interno do gateway retorna `password` descriptografado. Isso deve existir somente em rede interna, com token forte e minimo acesso.

Direcao V2:

- Nao expor credenciais no frontend.
- Gateway deve ser o unico consumidor de credenciais.
- Preferir secret manager ou token por camera.
- Auditar acesso ao endpoint interno.

### A13 - API dashboard existe, mas frontend recalcula tudo localmente

Impacto: medio.

A rota `/api/dashboard` agrega dados no backend, mas a tela `Dashboard` chama listas separadas e recalcula no cliente.

Direcao V2:

- Usar `/api/dashboard` como fonte principal.
- Reduzir chamadas e inconsistencias de calculo.
- Incluir runtime das cameras e estatisticas de eventos.

### A14 - Turma e presenca usam nome de turma em alguns filtros

Impacto: medio.

Fluxos ainda filtram por `turma`/`className`, embora exista `classId`. Nomes podem mudar, duplicar por escola ou turno, e gerar inconsistencias.

Direcao V2:

- Usar `turmaId` como identificador primario em filtros e updates.
- Manter `className` apenas como snapshot/label.

### A15 - Ausencia automatica nao esta modelada

Impacto: medio.

O sistema mostra ausentes com base em estado atual, mas nao ha rotina clara de fechamento de chamada/ausencia por horario.

Direcao V2:

- Criar job de fechamento por turno.
- Gerar ausencia pendente apos horario limite.
- Notificar ausencia somente apos regra de negocio.

### A16 - Retencao configurada mas nao executada

Impacto: medio.

Configuracoes de retencao existem, mas nao ha worker removendo snapshots, logs, eventos antigos ou arquivos biometricos conforme politica.

Direcao V2:

- Criar `retention-worker`.
- Separar retencao de snapshot, evento, audit log e biometria.
- Registrar exclusoes por politica.

### A17 - LGPD/consentimento ainda nao existe no modelo

Impacto: alto para producao.

Biometria de estudantes exige consentimento, finalidade, auditoria e controle de retencao.

Direcao V2:

- Criar entidade de consentimento por aluno/responsavel.
- Registrar data, usuario, documento/termo e versao.
- Bloquear biometria sem consentimento ativo.

### A18 - Testes de contrato e e2e ainda sao insuficientes

Impacto: medio.

Faltam testes para settings, autenticacao/roles, portal do responsavel, camera heartbeat, reconhecimento/evento/presenca e notificacao.

Direcao V2:

- Adicionar testes API com banco test.
- Adicionar e2e de fluxos criticos com Playwright.
- Criar testes de contrato para DTOs.

## Backlog de alinhamento V2

### P0 - Bloqueadores

1. Implementar RBAC nas rotas da API.
2. Criar portal real do responsavel com endpoints escopados.
3. Corrigir contrato de settings frontend/backend.
4. Resolver estrategia de schema do Face Server.
5. Remover decisao de match do frontend como fonte de verdade.
6. Corrigir encoding/mojibake.

### P1 - Operacao real

1. Expor `CameraRuntimeStatus` no DTO de cameras.
2. Usar runtime status no dashboard e telas de camera.
3. Criar fila de revisao de eventos `UNKNOWN` e `REVIEW_REQUIRED`.
4. Criar worker de notificacao real.
5. Criar worker de ausencia por horario/turno.
6. Criar origem/auditoria da presenca.

### P2 - UX e produto

1. Separar "Cameras", "Vigia operacional" e "Revisao facial".
2. Transformar `/pwa` em app/area real de responsavel.
3. Usar `/api/dashboard` no dashboard.
4. Padronizar labels, mensagens e estados vazios.
5. Substituir `window.confirm` por dialogs consistentes.

### P3 - Governanca e producao

1. Modelar consentimento LGPD.
2. Criar retention worker.
3. Criar audit log.
4. Externalizar secrets.
5. Criar observabilidade de cameras, reconhecimento e notificacoes.
6. Criar testes e2e dos fluxos principais.

## Ordem recomendada

1. Corrigir settings e encoding.
2. Implementar RBAC e portal do responsavel escopado.
3. Resolver schema do Face Server.
4. Ligar `CameraRuntimeStatus` no frontend.
5. Criar revisao de eventos desconhecidos.
6. Criar notification worker.
7. Criar consentimento e auditoria.
8. Completar reconhecimento server-side.

## Status de implementacao atual

- RBAC aplicado nas rotas administrativas da API, mantendo o portal do responsavel em endpoint escopado.
- Contrato de settings alinhado entre frontend e backend, com aliases para compatibilidade.
- Dashboard passou a consumir `/api/dashboard`.
- `CameraRuntimeStatus` passou a ser exposto no DTO de cameras e exibido na tela de cameras.
- Eventos desconhecidos passaram a ter estado proprio no DTO e no dashboard.
- Fila `/revisao-facial` criada para eventos em revisao/desconhecidos.
- Reenvio de notificacao volta para `PENDING`; entrega fica a cargo do `notification-worker`.
- Ajuste manual de presenca nao marca mais `recognized: true`.
- Workers de ausencia e retencao adicionados ao Compose.
