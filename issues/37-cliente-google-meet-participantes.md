# 37: Cliente Google Meet — lista real de participantes de uma reunião
**Tipo:** Implementação
**Página:** Módulo A — Coleta Automática de Participação
## Descrição
Criar módulo backend (ex.: `lib/google-meet.ts`) que, dado o `meet_url`/meeting code de um encontro, consulta a API Google Meet REST v2 (`conferenceRecords.list` filtrado por `space.meeting_code` + `conferenceRecords.participants.list`) e devolve os participantes reais com e-mail resolvido — a API retorna `signedinUser.user` (id) + `displayName`, então resolver id→e-mail via Admin SDK Directory reutilizando a impersonação de service account já existente em `lib/google-calendar.ts`, com fallback por displayName. Incluir os novos escopos OAuth (`meetings.space.readonly` e o de leitura do Directory) e tratar o caso de dados ainda não disponíveis (retorno distinguível para retry).

## Contexto técnico
- `lib/google-calendar.ts` já autentica com `google.auth.JWT` (service account + domain-wide delegation): `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`, `privateKey()` a partir de `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, e `subject` = e-mail do mentor impersonado (`GOOGLE_WORKSPACE_SUBJECTS`). O escopo atual é só `calendar.events.readonly`. `privateKey()` e a montagem do JWT são privados ao arquivo — extrair helper reutilizável.
- O link do Meet vem do sync (`event.hangoutLink || entryPoints[video].uri` em `listWorkspaceEvents`) e é gravado em `public.meetings.meet_url` (`supabase/migrations/202606300001_initial_schema.sql`, upsert em `app/api/calendar/sync/route.ts`). Formato: `https://meet.google.com/abc-mnop-xyz` (pode vir com query string). `meetings.google_calendar_id` guarda `"{subject}::{calendarId}"` — o chamador (issue 38/39) deriva daí o `subject` a impersonar.
- Google Meet REST v2 (`googleapis@^173` já inclui `google.meet("v2")` — verificado em `node_modules/googleapis/build/src/apis/meet/`):
  - `GET /v2/conferenceRecords` com `filter` EBNF sobre `space.meeting_code`, `space.name`, `start_time`, `end_time` (ex.: `space.meeting_code = "abc-mnop-xyz" AND start_time >= "2026-01-01T00:00:00.000Z"`). Escopo: `https://www.googleapis.com/auth/meetings.space.readonly`. Com esse escopo, o usuário impersonado precisa ser host/participante da reunião → impersonar o mentor dono do calendário do evento (o `subject`).
  - `GET /v2/{parent=conferenceRecords/*}/participants` (`pageSize` máx. 250): cada `Participant` traz `earliestStartTime`/`latestEndTime` e exatamente um de `signedinUser` (`user: "users/{id}"` + `displayName`), `anonymousUser` ou `phoneUser` — **sem e-mail**. Docs: "Unique ID for the user. Interoperable with Admin SDK API and People API."
  - Resolução id→e-mail: Admin SDK Directory `users.get({ userKey: "{id}" })` → `primaryEmail`, escopo `https://www.googleapis.com/auth/admin.directory.user.readonly` (`google.admin("directory_v1")`, também já no pacote). Exige impersonar uma conta com privilégio de leitura de usuários (admin) — os subjects atuais são mentores, sem garantia de admin → nova env `GOOGLE_WORKSPACE_ADMIN_SUBJECT` (fallback: primeiro de `GOOGLE_WORKSPACE_SUBJECTS`; se não for admin, a resolução falha por usuário e cai no fallback de displayName).
  - Conference records demoram a aparecer após o fim da reunião (podem levar minutos) — ausência de record NÃO é erro, é "ainda indisponível".

## Solução
Criar `lib/google-meet.ts` (com `import "server-only"`) expondo:
- `meetingCodeFromUrl(meetUrl: string): string | null` — extrai `abc-mnop-xyz` via regex `meet.google.com/([a-z]{3}-[a-z]{4}-[a-z]{3})` (ignora query string/fragment).
- `listMeetParticipants(input: { meetUrl: string; subject: string; startsAt: string; endsAt: string }): Promise<MeetParticipantsResult>` com

```ts
interface MeetParticipant {
  displayName: string;
  email: string | null;            // resolvido via Directory; null p/ anônimo, telefone ou falha
  kind: "signedin" | "anonymous" | "phone";
}
type MeetParticipantsResult =
  | { status: "ok"; participants: MeetParticipant[] }
  | { status: "unavailable" };     // sem conference record ainda (ou reunião em andamento) → retry
```

Fluxo interno:
1. Extrair meeting code do `meetUrl` (inválido → `throw` com mensagem clara).
2. JWT com `subject` (mentor host) e escopo `meetings.space.readonly`; `meet.conferenceRecords.list` com `filter`: `space.meeting_code = "{code}" AND start_time >= "{startsAt − 1h}" AND start_time <= "{endsAt}"` (janela restringe records de outras ocorrências do mesmo link recorrente), paginando por `nextPageToken`.
3. Nenhum record → `{ status: "unavailable" }`. Records só com `endTime` nulo (reunião ainda aberta) → `unavailable` também (lista incompleta).
4. Para cada record finalizado, `meet.conferenceRecords.participants.list` (paginado); múltiplos records na janela (reunião caiu/reiniciou) → mesclar, deduplicando por id do `signedinUser` (ou displayName p/ anônimo/telefone).
5. Resolver ids únicos: JWT com `GOOGLE_WORKSPACE_ADMIN_SUBJECT` e escopo `admin.directory.user.readonly`; `admin.users.get({ userKey: id })` → `primaryEmail.toLowerCase()`; memoizar por id na chamada; qualquer erro por usuário (404 externo ao domínio, 403 sem privilégio) → `email: null`, mantém `displayName`.
6. Em `lib/google-calendar.ts`, extrair e exportar `workspaceJwt(subject: string, scopes: string[])` (encapsula client email + `privateKey()` + `new google.auth.JWT`) e usar nas duas funções existentes — `google-meet.ts` importa esse helper (reuso, sem duplicar parsing da chave).

## Cenários

### Happy Path
1. Encontro individual encerrado ontem, `meet_url = https://meet.google.com/abc-mnop-xyz`: `listMeetParticipants` acha 1 conference record na janela, lista 2 participantes `signedinUser`, resolve os dois ids via Directory → `{ status: "ok", participants: [{ displayName, email, kind: "signedin" }, …] }`.
2. Encontro em grupo com 8 participantes: paginação de `participants.list` percorrida até o fim; todos com e-mail resolvido em minúsculas (compatível com o matching por e-mail da issue 38).

### Edge Cases
- **Record ainda não disponível** (rotina roda minutos após o fim): `conferenceRecords.list` vazio → `{ status: "unavailable" }`; o chamador (issue 39) reagenda a tentativa. Nenhum throw.
- **Reunião em andamento** (record existe com `endTime` nulo): também `unavailable` — só coletar lista final.
- **Link recorrente com vários conference records** (mesmo meeting code em ocorrências semanais): o filtro por `start_time` na janela do encontro retorna só o(s) record(s) da ocorrência certa.
- **Reunião reiniciada** (2 records dentro da mesma janela): participantes mesclados e deduplicados por id de usuário.
- **Participante anônimo ou por telefone**: entra na lista com `email: null` e `kind` correspondente (`displayName` do `anonymousUser`/`phoneUser`; telefone vem parcialmente mascarado).
- **Participante externo ao domínio** (Directory `users.get` → 404): `email: null`, `displayName` preservado — issue 38 o ignora no matching.
- **`GOOGLE_WORKSPACE_ADMIN_SUBJECT` ausente**: usa o primeiro subject de `GOOGLE_WORKSPACE_SUBJECTS`; se essa conta não tiver privilégio de leitura do Directory, cada `users.get` falha isoladamente → lista sai com e-mails nulos (funcional, degradado), sem abortar a coleta.
- **`meetUrl` sem meeting code reconhecível** (ex.: link de terceiros): `meetingCodeFromUrl` retorna `null` e `listMeetParticipants` lança erro descritivo — o chamador decide marcar o encontro como não coletável.

### Cenário de Erro
- **403 no Meet API** (escopo `meetings.space.readonly` não autorizado no domain-wide delegation, ou API não habilitada no projeto GCP): propagar erro com mensagem citando o escopo/API faltante — não confundir com `unavailable`.
- **Subject impersonado não é host/participante da reunião** (list retorna vazio por falta de acesso): resultado é `unavailable`; documentar no código que o `subject` deve ser o mentor dono do calendário do evento (`google_calendar_id` antes de `::`).
- **Falha transitória de rede/5xx do Google**: propagar (o retry é responsabilidade da rotina da issue 39); nenhum catch silencioso.

## Arquivos

### Criar
- `lib/google-meet.ts` — módulo novo: `meetingCodeFromUrl`, `listMeetParticipants`, tipos `MeetParticipant`/`MeetParticipantsResult`, resolução Directory com memoização.

### Modificar
- `lib/google-calendar.ts` — extrair/exportar helper `workspaceJwt(subject, scopes)` a partir do código JWT existente e usá-lo em `listWorkspaceEvents` e `fetchEventStatus` (refactor sem mudança de comportamento).
- `.env.example` — adicionar `GOOGLE_WORKSPACE_ADMIN_SUBJECT=admin@seudominio.com.br` com comentário (conta com leitura do Directory para resolver id→e-mail).

## Dependências Externas
- **Pacotes npm**: nenhum novo — `googleapis@^173` já instalado inclui `meet_v2` e `admin/directory_v1`.
- **Configuração manual no Google (admin do Workspace / GCP)**:
  1. Habilitar **Google Meet REST API** e **Admin SDK API** no projeto GCP da service account.
  2. No Admin Console (Segurança → Controles de API → Delegação em todo o domínio), adicionar ao client ID da service account os escopos novos, mantendo o existente:
     - `https://www.googleapis.com/auth/meetings.space.readonly`
     - `https://www.googleapis.com/auth/admin.directory.user.readonly`
     - (já autorizado) `https://www.googleapis.com/auth/calendar.events.readonly`
  3. Definir `GOOGLE_WORKSPACE_ADMIN_SUBJECT` nas envs (local e Vercel) apontando para uma conta com privilégio de leitura de usuários do Directory.

## Checklist
- [ ] `lib/google-meet.ts` criado com `import "server-only"` e sem nenhum uso em frontend.
- [ ] `meetingCodeFromUrl` extrai o code de links com/sem query string e retorna `null` para URL não reconhecida.
- [ ] `conferenceRecords.list` filtra por `space.meeting_code` E janela de `start_time`, com paginação.
- [ ] Sem record (ou record ainda aberto) → `{ status: "unavailable" }`, sem exception.
- [ ] Múltiplos records na janela → participantes mesclados e deduplicados.
- [ ] `signedinUser` resolvido para e-mail via Directory `users.get` (memoizado); anônimo/telefone/falha de resolução → `email: null` mantendo `displayName`.
- [ ] `workspaceJwt` exportado de `lib/google-calendar.ts` e reutilizado (nenhuma duplicação de `privateKey()`); `listWorkspaceEvents`/`fetchEventStatus` continuam com o mesmo comportamento.
- [ ] `.env.example` documenta `GOOGLE_WORKSPACE_ADMIN_SUBJECT`; nenhum secret novo no frontend.
- [ ] Erros de escopo/API não habilitada propagam com mensagem clara (distintos de `unavailable`).
- [ ] Nenhum arquivo fora dos listados foi tocado; nenhuma escrita no banco nesta issue (consumo fica para as issues 38/39).
