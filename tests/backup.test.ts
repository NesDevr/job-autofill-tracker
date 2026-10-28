import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { createBackup, parseBackupJson, restoreBackup, type FullBackup } from "../lib/backup";
import { db } from "../lib/db";
import { createDemoApplications, createDemoMemories, DEMO_PROFILE } from "../lib/demo";
import { DEFAULT_SETTINGS, type Profile, type Settings } from "../lib/schema";
import { getSettings, getStoredProfile } from "../lib/storage";

let storage: Record<string, unknown> = {};
let failNextStorageWrite = false;
Object.assign(globalThis, { chrome: { storage: { local: {
  async get(keys: string | string[]) {
    return Object.fromEntries((typeof keys === "string" ? [keys] : keys).filter((key) => key in storage).map((key) => [key, structuredClone(storage[key])]));
  },
  async set(values: Record<string, unknown>) {
    if (failNextStorageWrite) { failNextStorageWrite = false; throw new Error("Storage unavailable"); }
    Object.assign(storage, structuredClone(values));
  },
  async remove(keys: string[]) { for (const key of keys) delete storage[key]; }
} } } });

function fixture(): FullBackup {
  const profile: Profile = structuredClone(DEMO_PROFILE);
  profile.resumeFile = { name: "cv.pdf", type: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERg==" };
  profile.coverLetterFile = { name: "letter.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", dataUrl: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEs=" };
  const settings: Settings = { ...structuredClone(DEFAULT_SETTINGS), apiKey: "test-key", theme: "dark", customSearches: [{ id: "custom", label: "Search", url: "https://example.com/jobs" }] };
  const applications = createDemoApplications();
  applications.push({ ...applications[0], id: 9010, source: "Upwork", upwork: { status: "Responded", contractType: "hourly", currency: "USD", proposedAmount: 50, baseConnects: 16, boostBid: 20, boostCharged: null, respondedAt: "2026-09-30T00:00:00Z" } });
  return { format: "job-autofill-tracker-backup", version: 1, exportedAt: "2026-09-30T00:00:00Z", profile, settings, applications, answerMemory: createDemoMemories() };
}

beforeEach(async () => {
  await db.applications.clear();
  await db.answerMemory.clear();
  storage = {};
  failNextStorageWrite = false;
});
after(async () => { await db.delete(); });

test("full restore and re-export preserve jobs, outreach, Upwork, answers, attachments, settings and IDs", async () => {
  const backup = parseBackupJson(JSON.stringify(fixture()));
  await db.applications.add({ ...backup.applications[0], id: 1, company: "Old instance" });
  await restoreBackup(backup);
  const exported = await createBackup(storage.profile as Profile, storage.settings as Settings);
  assert.deepEqual({ ...exported, exportedAt: backup.exportedAt }, backup);
  const nextId = await db.applications.add({ ...backup.applications[0], id: undefined });
  assert.ok(typeof nextId === "number" && nextId > 9010, "new records must not collide with imported IDs");
});

test("a failed database write rolls back both tables before touching extension storage", async () => {
  const backup = fixture();
  await restoreBackup(backup);
  const broken = structuredClone(backup);
  broken.applications.push(broken.applications[0]);
  await assert.rejects(restoreBackup(broken));
  const exported = await createBackup(storage.profile as Profile, storage.settings as Settings);
  assert.deepEqual({ ...exported, exportedAt: backup.exportedAt }, backup);
});

test("a failed extension storage write restores previous records and settings", async () => {
  const original = fixture();
  await restoreBackup(original);
  const replacement = fixture();
  replacement.applications = [];
  replacement.answerMemory = [];
  replacement.settings.apiKey = "replacement-key";
  failNextStorageWrite = true;
  await assert.rejects(restoreBackup(replacement), /previous data was recovered/);
  const exported = await createBackup(storage.profile as Profile, storage.settings as Settings);
  assert.deepEqual({ ...exported, exportedAt: original.exportedAt }, original);
});

test("rollback preserves missing storage keys on a fresh instance", async () => {
  failNextStorageWrite = true;
  await assert.rejects(restoreBackup(fixture()), /previous data was recovered/);
  assert.deepEqual(storage, {});
  assert.equal(await db.applications.count(), 0);
  assert.equal(await db.answerMemory.count(), 0);
});

test("a valid empty backup replaces existing jobs and answer memory", async () => {
  const backup = fixture();
  await restoreBackup(backup);
  await restoreBackup({ ...backup, applications: [], answerMemory: [] });
  assert.equal(await db.applications.count(), 0);
  assert.equal(await db.answerMemory.count(), 0);
});

test("demo mode reads the real saved profile for backup", async () => {
  const backup = fixture();
  backup.profile.identity.firstName = "Actual user";
  storage = { profile: backup.profile, settings: { ...backup.settings, demoMode: true } };
  assert.deepEqual(await getStoredProfile(), backup.profile);
});

test("probe protection settings survive restore and older backups inherit the default", async () => {
  const backup = fixture();
  backup.settings.blockLinkedInExtensionProbes = false;
  await restoreBackup(parseBackupJson(JSON.stringify(backup)));
  assert.equal((await getSettings()).blockLinkedInExtensionProbes, false);
  Reflect.deleteProperty(backup.settings, "blockLinkedInExtensionProbes");
  await restoreBackup(parseBackupJson(JSON.stringify(backup)));
  assert.equal((await getSettings()).blockLinkedInExtensionProbes, true);
});

test("malformed, incompatible and unsafe backups are rejected before import", () => {
  assert.throws(() => parseBackupJson("{"), /not valid JSON/);
  const cases: Array<(backup: any) => void> = [
    (b) => { b.version = 2; },
    (b) => { b.applications.push(b.applications[0]); },
    (b) => { b.applications[0].status = "Bogus"; },
    (b) => { b.applications[0].jobUrl = "javascript:alert(1)"; },
    (b) => { b.applications[0].answersUsed = "bad"; },
    (b) => { b.applications[0].upwork = { status: "Submitted" }; },
    (b) => { b.applications[0].outreach = { status: "Lead" }; },
    (b) => { b.settings.customSearches[0].url = "data:text/html,bad"; },
    (b) => { b.settings.enabledSites.greenhouse = "true"; },
    (b) => { b.settings.blockLinkedInExtensionProbes = "false"; },
    (b) => { b.answerMemory[0].editable = "false"; },
    (b) => { b.profile.resumeFile.dataUrl = "data:text/html;base64,UEs="; },
    (b) => { b.profile.identity.email = 123; }
  ];
  for (const mutate of cases) {
    const backup = fixture();
    mutate(backup);
    assert.throws(() => parseBackupJson(JSON.stringify(backup)));
  }
  const forbidden = JSON.stringify(fixture()).replace('"profile":{', '"profile":{"__proto__":{"polluted":true},');
  assert.throws(() => parseBackupJson(forbidden), /forbidden key/);
  assert.equal(({} as any).polluted, undefined);
});
