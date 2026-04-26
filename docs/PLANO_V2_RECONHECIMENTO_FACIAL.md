# VigiaEscolar 2.0 - Plano de reconhecimento facial e cameras

## Objetivo

Transformar o MVP atual em uma arquitetura de producao para reconhecimento facial em ambiente escolar, com cameras IP/RTSP reais, processamento server-side, auditoria, revisao manual, notificacoes confiaveis e operacao monitoravel.

## Documento complementar

Esta evolucao depende tambem dos gaps gerais da aplicacao. A auditoria ampla esta em:

- [Auditoria V2 da aplicacao](AUDITORIA_V2_APLICACAO.md)

Os bloqueadores P0 dessa auditoria devem ser tratados junto com a evolucao facial para evitar uma V2 tecnicamente funcional, mas insegura ou desalinhada no produto.

## Diagnostico atual

### O que ja existe

- Cadastro de escolas, turmas, alunos, responsaveis, cameras, presencas e notificacoes na API principal.
- Tabelas para `Camera`, `CameraEvent`, `FaceIdentity`, `FaceEnrollment`, `FaceEmbedding` e `FaceRecognitionEvent`.
- Captura biometrica no cadastro de aluno via webcam do navegador usando `face-api.js`.
- Persistencia de foto, metadata de captura e embedding recebido do navegador.
- Tela de cameras com deteccao multi-rosto via `face-api.js` no navegador.
- Endpoint `/api/camera-events/reconhecer` para persistir reconhecimento e converter match em presenca.
- Servico separado `ultrazend-face-server`, com conceitos mais maduros de device, zone, enrollment, liveness e evento facial.

### Principais problemas

- Cameras RTSP/IP sao apenas cadastradas; nao ha ingestao real de stream.
- O navegador e quem processa o video ao vivo; isso funciona para demo com webcam, mas nao para cameras escolares em producao.
- O match inicial e feito no frontend, e a API recebe `expectedStudentId`. O servidor deveria ser a fonte de verdade do reconhecimento.
- O backend principal tem fallback de descritor `legacy-grayscale` 24x24, inadequado para reconhecimento facial real.
- Existem dois caminhos biometricos paralelos: API principal e `ultrazend-face-server`.
- `ultrazend-face-server` nao esta no `docker-compose.yml` principal.
- O modo vigia atual exige camera USB/dispositivo local e rejeita RTSP/IP.
- Eventos de camera sao persistidos como entrada por padrao no fluxo atual.
- Notificacoes sao criadas como pendentes, mas nao ha worker de entrega robusto.
- Modelos `face-api.js` carregam de CDN por padrao, fragil para producao.
- Falta monitoramento operacional de cameras: online/offline, FPS real, reconexao, ultimo frame, latencia e erro.

## Arquitetura alvo

```text
Camera IP/RTSP/USB
  -> Camera Gateway
      -> captura stream
      -> heartbeat
      -> amostragem de frames
      -> snapshot/preview
      -> envio de frames/eventos
  -> Face Server
      -> deteccao facial
      -> extracao de embedding
      -> matching vetorial
      -> liveness/qualidade
      -> deduplicacao
      -> fila de revisao
  -> API principal
      -> alunos/escolas/turmas/responsaveis
      -> presenca
      -> notificacoes
      -> auditoria
  -> Web
      -> painel operacional
      -> preview
      -> revisao manual
      -> relatorios
```

## Decisao tecnica recomendada

Usar o `ultrazend-face-server` como base do motor facial 2.0 e integrar a API principal a ele. A API principal deve parar de tomar decisoes biometricas por conta propria no longo prazo.

O `face-api.js` no navegador deve continuar existindo apenas como experiencia assistida de captura/cadastro, nunca como autoridade final de reconhecimento em producao.

## Epicos

### E1 - Unificacao do motor facial

**Objetivo:** definir o `ultrazend-face-server` como servico oficial de biometria facial.

Tarefas:

- Adicionar `face-server` ao `docker-compose.yml` principal.
- Configurar `FACE_PLATFORM_SERVICE_TOKEN`, storage e variaveis de seguranca.
- Corrigir rotas do `ultrazend-face-server` para passar `req.serviceAuth` para os metodos que aceitam contexto.
- Criar cliente interno na API principal para chamar o `face-server`.
- Definir contrato unico de enrollment, reconhecimento e evento facial.
- Criar migracao ou processo de sincronizacao das biometrias existentes da API principal para o `face-server`.

Aceite:

- `docker compose up` sobe API, Web, Postgres, Nginx e Face Server.
- `/health` do Face Server responde.
- API principal consegue consultar status do Face Server.
- Novo cadastro biometrico gera identidade no Face Server.

### E2 - Camera Gateway

**Objetivo:** processar cameras reais fora do navegador.

Tarefas:

- Criar app `apps/camera-gateway`.
- Ler configuracoes de cameras ativas da API principal ou Face Server.
- Abrir stream RTSP/IP com FFmpeg, GStreamer ou OpenCV.
- Implementar reconexao automatica.
- Registrar heartbeat por camera.
- Extrair frames em FPS configuravel.
- Enviar frames para o Face Server.
- Salvar snapshot de diagnostico.
- Expor preview HLS/WebRTC ou snapshot polling para o painel.

Aceite:

- Uma camera RTSP real gera heartbeat online.
- Queda da camera altera status para offline/degraded.
- Reconexao automatica funciona.
- Frames sao enviados para o Face Server sem depender do navegador.

### E3 - Reconhecimento server-side

**Objetivo:** remover a dependencia do frontend para matching real.

Tarefas:

- Implementar extracao de embedding no servidor.
- Escolher provider inicial: InsightFace/ArcFace, CompreFace, ou provider pluggable.
- Persistir embeddings em formato vetorial consistente.
- Avaliar `pgvector` para busca eficiente.
- Definir thresholds por tenant/escola:
  - match automatico
  - revisao manual
  - rejeicao
- Remover uso de `expectedStudentId` como filtro de reconhecimento em eventos de camera.
- Manter `expectedStudentId` apenas para validacao de cadastro/leitura individual.

Aceite:

- Um frame recebido pelo gateway pode ser reconhecido inteiramente no servidor.
- Evento com baixa confianca vira `REVIEW_REQUIRED`.
- Evento desconhecido vira `UNMATCHED`.
- API principal so recebe evento reconhecido/revisado para virar presenca.

### E4 - Cadastro biometrico 2.0

**Objetivo:** melhorar qualidade, seguranca e repetibilidade da biometria.

Tarefas:

- Capturar 3 a 5 amostras por aluno.
- Validar rosto unico.
- Validar qualidade minima.
- Validar nitidez/iluminacao quando possivel.
- Validar liveness.
- Criar status de enrollment:
  - `PENDING`
  - `APPROVED`
  - `REJECTED`
  - `NEEDS_RECAPTURE`
- Criar tela de revisao manual de cadastros biometricos.
- Guardar consentimento/autorizacao e trilha de auditoria.

Aceite:

- Cadastro ruim nao entra automaticamente em producao.
- Aluno pode ter multiplos templates ativos.
- Historico de aprovacoes e recusas fica auditavel.

### E5 - Devices, zonas e direcao

**Objetivo:** modelar cameras reais e regras de entrada/saida.

Tarefas:

- Separar camera fisica de zona logica.
- Uma camera pode ter varias zonas.
- Zona define direcao:
  - `ENTRY`
  - `EXIT`
  - `BOTH`
- Configurar janela de deduplicacao por zona.
- Configurar horario ativo por escola.
- Criar calibracao por camera: resolucao, FPS de analise, confianca minima.

Aceite:

- Evento de entrada e saida sao distinguidos corretamente.
- O mesmo aluno nao gera multiplas presencas em segundos.
- Camera fora de horario nao gera presenca automatica.

### E6 - Presenca e notificacoes

**Objetivo:** transformar evento facial em fluxo escolar confiavel.

Tarefas:

- Criar worker de conversao evento -> presenca.
- Criar worker de notificacao.
- Integrar WhatsApp real ou gateway configuravel.
- Definir politica para ausencia, atraso, entrada e saida.
- Criar retentativas e status de entrega.
- Registrar erros de notificacao.

Aceite:

- Presenca e criada apenas a partir de evento aprovado/confiavel.
- Notificacao tem status real: pending, sent, failed.
- Falha de notificacao nao quebra reconhecimento.

### E7 - Painel operacional

**Objetivo:** dar controle real para operadores.

Tarefas:

- Dashboard de cameras:
  - online/offline/degraded
  - ultimo heartbeat
  - FPS real
  - ultima deteccao
  - ultimo erro
- Preview por camera.
- Eventos em tempo real.
- Fila de revisao.
- Tela de desconhecidos.
- Acao manual: aprovar, rejeitar, vincular aluno, ignorar.
- Relatorios por escola, aluno, camera e periodo.

Aceite:

- Operador consegue diagnosticar camera sem acessar servidor.
- Eventos duvidosos nao somem.
- Revisao manual atualiza presenca quando aprovada.

### E8 - Observabilidade e seguranca

**Objetivo:** preparar para producao e LGPD.

Tarefas:

- Logs estruturados por camera, evento, aluno e tenant.
- Metricas:
  - FPS processado
  - tempo por frame
  - taxa de match
  - taxa de review
  - taxa de unknown
  - disponibilidade por camera
- Healthchecks por servico.
- Retencao de snapshots e eventos.
- Criptografia de credenciais de camera.
- Controle de acesso por papel.
- Auditoria de acesso a biometria.
- Termo de consentimento e justificativa de tratamento de dados.

Aceite:

- Administrador consegue ver saude do pipeline.
- Snapshots antigos seguem regra de retencao.
- Credenciais sensiveis nao aparecem em payloads de API.

## Fases de entrega

### Fase 0 - Preparacao tecnica

Duracao estimada: 2 a 4 dias.

- Documentar arquitetura.
- Definir contratos de API.
- Escolher provider de reconhecimento server-side.
- Definir formato de evento facial canonico.

Entrega:

- Documento de arquitetura aprovado.
- Backlog priorizado.

### Fase 1 - Integracao do Face Server

Duracao estimada: 1 semana.

- Subir Face Server no compose.
- Corrigir contexto de tenant.
- Criar cliente interno na API principal.
- Expor status do motor facial na tela de configuracoes ou cameras.

Entrega:

- Servico facial operacional no ambiente local.

### Fase 2 - Gateway RTSP minimo

Duracao estimada: 1 a 2 semanas.

- Criar `apps/camera-gateway`.
- Conectar uma camera RTSP.
- Extrair frames.
- Enviar snapshots para o Face Server.
- Registrar heartbeat.

Entrega:

- Primeira camera real gerando eventos tecnicos.

### Fase 3 - Reconhecimento real

Duracao estimada: 2 semanas.

- Embedding server-side.
- Matching vetorial.
- Eventos `MATCHED`, `REVIEW_REQUIRED`, `UNMATCHED`.
- Deduplicacao robusta.

Entrega:

- Evento facial real gerado por camera RTSP.

### Fase 4 - Presenca e notificacao

Duracao estimada: 1 a 2 semanas.

- Worker de presenca.
- Worker de notificacao.
- Entrada/saida por zona.
- Tela de eventos e presencas sincronizada.

Entrega:

- Aluno reconhecido gera presenca e notificacao.

### Fase 5 - Operacao piloto

Duracao estimada: 2 semanas.

- Instalar em uma escola piloto.
- Calibrar thresholds.
- Medir falso positivo/falso negativo.
- Ajustar iluminacao, angulo e posicionamento.
- Criar relatorio de estabilidade.

Entrega:

- Go/no-go para expansao.

## Primeiros tickets executaveis

### T1 - Adicionar Face Server ao compose principal

- Adicionar servico `face-server`.
- Usar `ultrazend-face-server/Dockerfile`.
- Configurar `DATABASE_URL`, `FACE_PLATFORM_SERVICE_TOKEN`, `FACE_PLATFORM_ENCRYPTION_KEY` e volume de uploads.
- Adicionar healthcheck.

Status: implementado como base inicial no `docker-compose.yml`.

### T2 - Corrigir tenant context nas rotas do Face Server

- Em `face-platform.routes.ts`, passar `req.serviceAuth` para:
  - `createEnrollment`
  - `deleteCitizenBiometry`
  - `ingestRecognition`
  - `reviewEvent`
- Ajustar tipos para usar `AuthenticatedServiceRequest`.

Status: implementado.

### T3 - Criar cliente interno da API principal para Face Server

- Criar `apps/api/src/services/face-platform/client.ts`.
- Configurar base URL e service token via env.
- Implementar:
  - `getStatus`
  - `createEnrollment`
  - `ingestRecognition`
  - `listEvents`

Status: `getStatus` implementado. `createEnrollment`, `ingestRecognition` e `listEvents` permanecem como proximos passos do contrato de integracao.

### T4 - Criar endpoint de status facial na API principal

- Criar rota ou extender `/api/biometria/status`.
- Retornar status local + status do Face Server.
- Mostrar indisponibilidade sem quebrar a API principal.

Status: implementado em `/api/biometria/status`.

### T5 - Desenhar contrato do Camera Gateway

- Definir payload de frame/evento.
- Definir autenticacao entre gateway e Face Server.
- Definir heartbeat.
- Definir status de camera.

Status: contrato inicial de cameras e heartbeat implementado em `/api/internal/camera-gateway`.

### T6 - Criar esqueleto de `apps/camera-gateway`

- App Node/TypeScript.
- Healthcheck.
- Leitura de env.
- Cliente HTTP para Face Server.
- Worker fake que envia heartbeat.

Status: app criado com leitura da API principal, workers por camera e heartbeat real.

### T7 - Implementar leitura RTSP inicial

- Escolher biblioteca/comando FFmpeg.
- Abrir stream.
- Extrair 1 frame por segundo.
- Persistir snapshot local temporario.
- Enviar frame para Face Server.

Status: leitura inicial via FFmpeg implementada com snapshots locais e heartbeat. Envio ao Face Server depende da etapa de embedding server-side.

## Riscos

- Cameras RTSP variam muito por fabricante e configuracao.
- CPU pode ficar insuficiente com muitas cameras; GPU pode ser necessaria.
- Iluminacao e angulo das cameras impactam mais que o software.
- Reconhecimento facial em criancas exige calibracao cuidadosa e revisao humana.
- LGPD exige base legal, consentimento/termo, controle de acesso e retencao.
- Falso positivo em ambiente escolar e risco alto; deve haver thresholds conservadores.

## Recomendacao de piloto

Comecar com uma escola, um portao e duas cameras:

- Uma camera para entrada.
- Uma camera para saida ou angulo complementar.
- 30 a 50 alunos cadastrados com consentimento.
- Medir por pelo menos 5 dias letivos:
  - taxa de reconhecimento correto
  - taxa de desconhecidos
  - taxa de revisao
  - falsos positivos
  - tempo medio ate notificacao
  - disponibilidade da camera

## Definicao de pronto da versao 2.0

- Camera RTSP real opera sem navegador aberto.
- Reconhecimento ocorre no servidor.
- Presenca e gerada a partir de evento confiavel.
- Eventos duvidosos entram em revisao.
- Notificacao tem entrega rastreavel.
- Operador enxerga saude das cameras.
- Dados biometricos tem auditoria, retencao e controle de acesso.

## Status de implementacao atual

- Face Server isolado em banco proprio no `docker-compose.yml`, evitando conflito de schema com a API principal.
- Cliente interno da API principal expandido com `createEnrollment`, `ingestRecognition` e `listEvents`.
- Camera Gateway passa a enviar snapshots para `/api/internal/camera-gateway/recognition`.
- Ingestao interna de reconhecimento cria `FaceRecognitionEvent`, `CameraEvent`, presenca e notificacao pendente quando ha match confiavel.
- Eventos `UNKNOWN` deixam de ser serializados como saida.
- Tela `/revisao-facial` criada para fila de eventos `REVIEW_REQUIRED`, `UNMATCHED` e `MATCHED`.
- Workers separados adicionados para notificacao, ausencia automatica e retencao.
