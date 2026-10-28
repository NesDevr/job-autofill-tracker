import { db } from "./db";
import { parseProfileJson } from "./profileImport";
import { APPLICATION_STATUSES, EMPTY_PROFILE, OUTREACH_CONTACT_METHODS, OUTREACH_STATUSES, type AnswerMemory, type Application, type Profile, type Settings } from "./schema";
import { UPWORK_PROPOSAL_STATUSES } from "./upwork";

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const BACKUP_FORMAT = "job-autofill-tracker-backup";

export type FullBackup = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  profile: Profile;
  settings: Settings;
  applications: Application[];
  answerMemory: AnswerMemory[];
};

type JsonObject = Record<string, unknown>;

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  return value as JsonObject;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > 100_000) throw new Error(`${path} must be an array with at most 100,000 items.`);
  return value;
}

function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`${path} must be text.`);
}

function boolean(value: unknown, path: string) {
  if (typeof value !== "boolean") throw new Error(`${path} must be true or false.`);
}

function choice(value: unknown, choices: readonly string[], path: string) {
  if (typeof value !== "string" || !choices.includes(value)) throw new Error(`${path} has an unsupported value.`);
}

function strings(item: JsonObject, keys: readonly string[], path: string, optional = false) {
  for (const key of keys) if (!optional || item[key] !== undefined) string(item[key], `${path}.${key}`);
}

function stringList(value: unknown, path: string) {
  array(value, path).forEach((item, index) => string(item, `${path}[${index}]`));
}

function optionalNumbers(item: JsonObject, keys: readonly string[], path: string) {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
      throw new Error(`${path}.${key} must be a non-negative number or null.`);
    }
  }
}

function webUrl(value: unknown, path: string) {
  string(value, path);
  if (!value) return;
  try {
    if (["http:", "https:"].includes(new URL(value).protocol)) return;
  } catch { /* Show the same useful error for malformed URLs and unsafe schemes. */ }
  throw new Error(`${path} must be an http or https URL.`);
}

function validateFile(value: unknown, path: string) {
  if (value === undefined) return;
  const file = object(value, path);
  strings(file, ["name", "type", "dataUrl"], path);
  const dataUrl = file.dataUrl as string;
  // FileReader-generated binary data only; never restore executable data URLs.
  const match = /^data:(application\/(?:pdf|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || match[1] !== file.type || match[2].length % 4 !== 0) throw new Error(`${path} must contain a valid PDF or Word file.`);
}

function validateProfile(value: unknown) {
  const profile = object(value, "profile");
  const { resumeFile, coverLetterFile, ...facts } = profile;
  parseProfileJson(JSON.stringify(facts), EMPTY_PROFILE);
  validateFile(resumeFile, "profile.resumeFile");
  validateFile(coverLetterFile, "profile.coverLetterFile");
}

function validateSettings(value: unknown) {
  const settings = object(value, "settings");
  strings(settings, ["apiKey", "model"], "settings");
  for (const key of ["demoMode", "matchScoring", "freelanceOptions"]) boolean(settings[key], `settings.${key}`);
  // Backups created before probe protection inherit its default setting.
  if (settings.blockLinkedInExtensionProbes !== undefined) boolean(settings.blockLinkedInExtensionProbes, "settings.blockLinkedInExtensionProbes");
  choice(settings.provider, ["openai"], "settings.provider");
  choice(settings.theme, ["light", "dark"], "settings.theme");
  choice(settings.trackingEntryMode, ["manual", "ai"], "settings.trackingEntryMode");
  for (const key of ["hiddenPresetSearches", "ignoredCompanies"]) stringList(settings[key], `settings.${key}`);
  array(settings.visibleBoardStatuses, "settings.visibleBoardStatuses").forEach((value) => choice(value, APPLICATION_STATUSES, "settings.visibleBoardStatuses"));
  const sites = object(settings.enabledSites, "settings.enabledSites");
  for (const key of ["greenhouse", "lever", "ashby", "linkedin"]) boolean(sites[key], `settings.enabledSites.${key}`);
  array(settings.customSearches, "settings.customSearches").forEach((value, index) => {
    const path = `settings.customSearches[${index}]`;
    const search = object(value, path);
    strings(search, ["id", "label"], path);
    webUrl(search.url, `${path}.url`);
  });
}

function validateRows(value: unknown, path: string, validate: (row: JsonObject, path: string) => void) {
  const ids = new Set<number>();
  array(value, path).forEach((value, index) => {
    const rowPath = `${path}[${index}]`;
    const row = object(value, rowPath);
    if (typeof row.id !== "number" || !Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id)) {
      throw new Error(`${rowPath}.id must be a unique positive integer.`);
    }
    ids.add(row.id);
    validate(row, rowPath);
  });
}

function validateApplication(row: JsonObject, path: string) {
  strings(row, ["company", "role", "source", "dateApplied", "notes"], path);
  strings(row, ["location", "jobDescription", "resumeVersion", "nextActionDate"], path, true);
  webUrl(row.jobUrl, `${path}.jobUrl`);
  choice(row.status, APPLICATION_STATUSES, `${path}.status`);
  if (row.workMode !== undefined) choice(row.workMode, ["", "Remote", "Hybrid", "On-site"], `${path}.workMode`);
  array(row.answersUsed, `${path}.answersUsed`).forEach((value, index) => strings(object(value, `${path}.answersUsed[${index}]`), ["question", "answer"], `${path}.answersUsed[${index}]`));
  if (row.compensation !== undefined) {
    const item = object(row.compensation, `${path}.compensation`);
    strings(item, ["text"], `${path}.compensation`);
    choice(item.currency, ["", "MXN", "USD", "EUR"], `${path}.compensation.currency`);
    choice(item.period, ["", "year", "month", "hour", "one-time"], `${path}.compensation.period`);
    optionalNumbers(item, ["min", "max"], `${path}.compensation`);
  }
  if (row.upwork !== undefined) {
    const item = object(row.upwork, `${path}.upwork`);
    choice(item.status, UPWORK_PROPOSAL_STATUSES, `${path}.upwork.status`);
    choice(item.contractType, ["", "hourly", "fixed"], `${path}.upwork.contractType`);
    choice(item.currency, ["", "MXN", "USD", "EUR"], `${path}.upwork.currency`);
    optionalNumbers(item, ["proposedAmount", "baseConnects", "boostBid", "boostCharged"], `${path}.upwork`);
    strings(item, ["respondedAt", "interviewedAt", "offeredAt", "hiredAt"], `${path}.upwork`, true);
  }
  if (row.outreach !== undefined) {
    const item = object(row.outreach, `${path}.outreach`);
    choice(item.status, OUTREACH_STATUSES, `${path}.outreach.status`);
    choice(item.contactMethod, ["", ...OUTREACH_CONTACT_METHODS], `${path}.outreach.contactMethod`);
    strings(item, ["contactName", "contactDetails"], `${path}.outreach`);
    strings(item, ["contactedAt"], `${path}.outreach`, true);
  }
}

export function parseBackupJson(text: string): FullBackup {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error("Backup is larger than 50 MB.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("Backup is not valid JSON."); }
  // Iterative traversal also handles deeply nested hostile input without recursion.
  const pending: unknown[] = [parsed];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`Backup contains a forbidden key: ${key}.`);
      if (child && typeof child === "object") pending.push(child);
    }
  }
  const root = object(parsed, "backup");
  if (root.format !== BACKUP_FORMAT || root.version !== 1) throw new Error("Choose a supported full Job Autofill + Tracker backup (version 1).");
  string(root.exportedAt, "exportedAt");
  if (!Number.isFinite(Date.parse(root.exportedAt))) throw new Error("Backup export date is invalid.");
  validateProfile(root.profile);
  validateSettings(root.settings);
  validateRows(root.applications, "applications", validateApplication);
  validateRows(root.answerMemory, "answerMemory", (row, path) => {
    strings(row, ["questionHash", "questionText", "answer", "lastUsed"], path);
    boolean(row.editable, `${path}.editable`);
  });
  return root as FullBackup;
}

export async function createBackup(profile: Profile, settings: Settings): Promise<FullBackup> {
  const records = await db.transaction("r", db.applications, db.answerMemory, async () => ({
    applications: await db.applications.toArray(),
    answerMemory: await db.answerMemory.toArray()
  }));
  return parseBackupJson(JSON.stringify({ format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), profile, settings, ...records }));
}

async function replaceRecords(backup: Pick<FullBackup, "applications" | "answerMemory">) {
  await db.applications.clear();
  await db.answerMemory.clear();
  if (backup.applications.length) await db.applications.bulkAdd(backup.applications);
  if (backup.answerMemory.length) await db.answerMemory.bulkAdd(backup.answerMemory);
}

export async function restoreBackup(backup: FullBackup): Promise<void> {
  const previousStorage = await chrome.storage.local.get(["profile", "settings"]);
  const previousRecords = await db.transaction("rw", db.applications, db.answerMemory, async () => {
    const records = { applications: await db.applications.toArray(), answerMemory: await db.answerMemory.toArray() };
    await replaceRecords(backup);
    return records;
  });
  try {
    await chrome.storage.local.set({ profile: backup.profile, settings: backup.settings });
  } catch (error) {
    try {
      await db.transaction("rw", db.applications, db.answerMemory, () => replaceRecords(previousRecords));
      await chrome.storage.local.set(previousStorage);
      const absentKeys = ["profile", "settings"].filter((key) => !(key in previousStorage));
      if (absentKeys.length) await chrome.storage.local.remove(absentKeys);
    } catch {
      throw new Error("Restore failed and the previous data could not be fully recovered. Keep your original backup; export the remaining data before retrying.");
    }
    throw new Error(`Restore failed; your previous data was recovered. ${error instanceof Error ? error.message : String(error)}`);
  }
}
