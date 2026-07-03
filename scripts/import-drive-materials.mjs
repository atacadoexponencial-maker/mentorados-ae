import process from "node:process";
import pg from "pg";
import { google } from "googleapis";

// Importação de EXECUÇÃO ÚNICA das gravações e resumos de reunião do Google Drive
// (pastas de cliente dentro de "1 ATIVOS AE") para public.mentee_materials.
//
// Padrões reaproveitados:
//   - auth JWT delegada / tratamento da chave privada: scripts/backfill-calendar.mjs:22-31
//   - matching marca->cliente e relatório: scripts/import-briefing.mjs:59-79
//   - normalize: cópia de app/api/calendar/sync/route.ts:9-11 (normalized)
//
// O script coleta tudo do Drive em memória ANTES da transação; as escritas são
// idempotentes (upsert por drive_file_id) e atômicas (falha => rollback total).
// Pré-requisito de produção: migrations da issue 19 (mentee_materials) aplicadas
// e encontros históricos da issue 22 já importados (senão nada casa com encontro).
// Execução: node scripts/import-drive-materials.mjs [folderId]

process.loadEnvFile(".env.local");

// Validação de ambiente — mesmo bloco de scripts/backfill-calendar.mjs:22-26
const connectionString = process.env.DATABASE_URL;
const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL;
const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
if (!connectionString || !email || !rawKey) throw new Error("Configuracao incompleta.");

// Chave privada — cópia de lib/google-calendar.ts (privateKey) / scripts/backfill-calendar.mjs:29-31
const key = rawKey.includes("BEGIN PRIVATE KEY")
  ? rawKey
  : `-----BEGIN PRIVATE KEY-----\n${rawKey.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;

// Subject delegado: GOOGLE_DRIVE_SUBJECT, senão o primeiro subject do Calendar
// (mesma leitura de configuredSubjects em scripts/backfill-calendar.mjs:34-41).
const workspaceSubjects = (process.env.GOOGLE_WORKSPACE_SUBJECTS || process.env.GOOGLE_WORKSPACE_SUBJECT || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const subject = process.env.GOOGLE_DRIVE_SUBJECT?.trim().toLowerCase() || workspaceSubjects[0];
if (!subject) throw new Error("Nenhum usuario delegado configurado para o Google Drive.");

// Pasta raiz "1 ATIVOS AE": argv -> DRIVE_ATIVOS_FOLDER_ID -> padrão.
const rootFolderId = process.argv[2] || process.env.DRIVE_ATIVOS_FOLDER_ID || "1mD-icXalCyRuVp8_gcNEh3ifSF8eusHM";

// Normalização — cópia de app/api/calendar/sync/route.ts:9-11 (normalized)
const normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Escopo EXATAMENTE https://www.googleapis.com/auth/drive — único autorizado na
// delegação do Workspace (nenhum .readonly/.metadata).
const auth = new google.auth.JWT({ email, key, subject, scopes: ["https://www.googleapis.com/auth/drive"] });
const drive = google.drive({ version: "v3", auth });

// Listagem paginada em Drive compartilhado.
async function listAll(q) {
  const files = [];
  let pageToken;
  do {
    const response = await drive.files.list({
      q,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      pageSize: 1000,
      fields: "nextPageToken, files(id, name, mimeType, webViewLink, createdTime)",
      pageToken,
    });
    files.push(...(response.data.files ?? []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
  return files;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Cobre "… - 2026/05/20 16:46 GMT-03:00 - Recording" e "… - 2026_03_05 15_32 GMT-03_00 - Recording.mp4".
const DATE_PATTERN = /(\d{4})[\/_](\d{2})[\/_](\d{2})\s+(\d{2})[:_](\d{2})\s*GMT([+-]\d{2})[:_](\d{2})/;

const database = new pg.Client({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
try {
  await database.connect();
  // Sem filtro de status: pastas de clientes hoje encerrados também têm histórico.
  const mentees = (await database.query("select id, name, company, brand_aliases from public.mentees")).rows;
  const meetings = (await database.query(
    "select id, individual_mentee_id, starts_at, ends_at from public.meetings where type = 'individual' and individual_mentee_id is not null",
  )).rows;
  const meetingsByMentee = new Map();
  for (const meeting of meetings) {
    if (!meetingsByMentee.has(meeting.individual_mentee_id)) meetingsByMentee.set(meeting.individual_mentee_id, []);
    meetingsByMentee.get(meeting.individual_mentee_id).push(meeting);
  }

  // ---- Coleta completa do Drive em memória (nenhuma escrita ainda) ----
  const clientFolders = await listAll(`'${rootFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`);

  const unmatchedFolders = [];
  const ambiguousFolders = [];
  const foldersWithoutRecordings = [];
  const fallbackDates = [];
  const withoutMeeting = [];
  const matchedMenteeIds = new Set();
  let matchedFolders = 0;
  let ignored = 0;
  const materials = [];

  for (const folder of clientFolders) {
    // Matching pasta<->cliente — mesma estratégia de scripts/import-briefing.mjs:59-79:
    // exato primeiro, senão continência parcial nos dois sentidos, contra company, name
    // e cada apelido de brand_aliases (apelido segue a mesma regra da marca).
    const folderKey = normalize(folder.name);
    let matches = folderKey
      ? mentees.filter((mentee) =>
          folderKey === normalize(mentee.company)
          || folderKey === normalize(mentee.name)
          || (mentee.brand_aliases ?? []).some((alias) => folderKey === normalize(alias)))
      : [];
    if (folderKey && matches.length === 0) {
      matches = mentees.filter((mentee) => {
        const company = normalize(mentee.company);
        const name = normalize(mentee.name);
        const aliasMatch = (mentee.brand_aliases ?? []).some((alias) => {
          const a = normalize(alias);
          return a && (a.includes(folderKey) || folderKey.includes(a));
        });
        return (company && (company.includes(folderKey) || folderKey.includes(company)))
          || (name && (name.includes(folderKey) || folderKey.includes(name)))
          || aliasMatch;
      });
    }
    const distinctIds = [...new Set(matches.map((mentee) => mentee.id))];
    if (distinctIds.length === 0) { unmatchedFolders.push(folder.name); continue; }
    if (distinctIds.length > 1) { ambiguousFolders.push(folder.name); continue; }
    const mentee = matches[0];
    matchedFolders += 1;
    matchedMenteeIds.add(mentee.id);

    // Subpasta de gravações: primeira cujo nome normalizado contém "grava"
    // (cobre "1_GRAVAÇÕES", "01_GRAVAÇÕES" e variações — a normalização remove acentos).
    const subfolders = await listAll(`'${folder.id}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`);
    const recordingsFolder = subfolders.find((subfolder) => normalize(subfolder.name).includes("grava"));
    if (!recordingsFolder) { foldersWithoutRecordings.push(folder.name); continue; }

    const files = await listAll(`'${recordingsFolder.id}' in parents and mimeType != '${FOLDER_MIME}' and trashed = false`);
    for (const file of files) {
      // Classificação: vídeo -> gravação; Doc/.docx "Anotações do Gemini" -> resumo; resto ignorado.
      const isVideo = (file.mimeType ?? "").startsWith("video/");
      const isGeminiSummary = (file.mimeType === GOOGLE_DOC_MIME || file.mimeType === DOCX_MIME)
        && normalize(file.name).includes("anotacoes do gemini");
      if (!isVideo && !isGeminiSummary) { ignored += 1; continue; }
      const type = isVideo ? "recording" : "summary";

      // Data/hora do nome ("AAAA/MM/DD HH:MM GMT-03:00", também com "_"), com
      // fallback para a data de criação no Drive.
      const dateMatch = file.name.match(DATE_PATTERN);
      let happenedAt;
      if (dateMatch) {
        const [, year, month, day, hour, minute, offsetHour, offsetMinute] = dateMatch;
        happenedAt = new Date(`${year}-${month}-${day}T${hour}:${minute}:00${offsetHour}:${offsetMinute}`).toISOString();
      } else {
        happenedAt = new Date(file.createdTime).toISOString();
        fallbackDates.push(`${file.name} (${mentee.name})`);
      }

      // Casamento material<->encontro: encontro individual do cliente mais próximo do horário
      // do material, com tolerância de 3h — gravações começam antes/depois do horário agendado
      // (ex.: gravação 15:40 de encontro marcado às 16:00). Distância medida até o intervalo do encontro.
      const happenedTime = new Date(happenedAt).getTime();
      const tolerance = 3 * 60 * 60 * 1000;
      let best = null;
      for (const meeting of meetingsByMentee.get(mentee.id) ?? []) {
        const startTime = new Date(meeting.starts_at).getTime();
        const endTime = new Date(meeting.ends_at).getTime();
        const distance = happenedTime < startTime ? startTime - happenedTime : happenedTime > endTime ? happenedTime - endTime : 0;
        if (distance <= tolerance && (best === null || distance < best.distance)) best = { id: meeting.id, distance };
      }
      const meetingId = best ? best.id : null;
      if (!meetingId) withoutMeeting.push(`${file.name} (${mentee.name})`);

      materials.push({
        menteeId: mentee.id,
        meetingId,
        type,
        title: file.name,
        driveFileId: file.id,
        driveUrl: file.webViewLink,
        happenedAt,
      });
    }
  }

  // ---- Escritas em transação única ----
  await database.query("begin");
  for (const material of materials) {
    await database.query(`
      insert into public.mentee_materials (
        mentee_id, meeting_id, type, title, drive_file_id, drive_url, happened_at
      ) values ($1, $2, $3::public.material_type, $4, $5, $6, $7)
      on conflict (drive_file_id) do update set
        mentee_id = excluded.mentee_id,
        meeting_id = excluded.meeting_id,
        type = excluded.type,
        title = excluded.title,
        drive_url = excluded.drive_url,
        happened_at = excluded.happened_at
    `, [material.menteeId, material.meetingId, material.type, material.title, material.driveFileId, material.driveUrl, material.happenedAt]);
  }
  await database.query("commit");

  // ---- Relatório final ----
  const menteesWithoutFolder = mentees.filter((mentee) => !matchedMenteeIds.has(mentee.id));
  const recordings = materials.filter((material) => material.type === "recording").length;
  const summaries = materials.filter((material) => material.type === "summary").length;
  console.log("Importação do Drive concluída.");
  console.log(`Pastas de cliente encontradas: ${clientFolders.length}`);
  console.log(`Pastas casadas: ${matchedFolders}`);
  console.log(`Pastas sem correspondência (${unmatchedFolders.length}): ${unmatchedFolders.join(", ") || "—"}`);
  console.log(`Pastas ambíguas (${ambiguousFolders.length}): ${ambiguousFolders.join(", ") || "—"}`);
  console.log(`Clientes sem pasta (${menteesWithoutFolder.length}): ${menteesWithoutFolder.map((mentee) => mentee.name).join(", ") || "—"}`);
  console.log(`Pastas sem subpasta de gravações (${foldersWithoutRecordings.length}): ${foldersWithoutRecordings.join(", ") || "—"}`);
  console.log(`Gravações registradas: ${recordings}`);
  console.log(`Resumos registrados: ${summaries}`);
  console.log(`Arquivos ignorados: ${ignored}`);
  console.log(`Datas não extraídas do nome — fallback createdTime (${fallbackDates.length}):`);
  for (const entry of fallbackDates) console.log(`  ${entry}`);
  if (fallbackDates.length === 0) console.log("  —");
  console.log(`Materiais sem encontro casado (${withoutMeeting.length}):`);
  for (const entry of withoutMeeting) console.log(`  ${entry}`);
  if (withoutMeeting.length === 0) console.log("  —");
} catch (error) {
  await database.query("rollback").catch(() => undefined);
  console.error(`Falha na importação do Drive: ${error instanceof Error ? error.message : "erro desconhecido"}`);
  process.exitCode = 1;
} finally {
  await database.end().catch(() => undefined);
}
