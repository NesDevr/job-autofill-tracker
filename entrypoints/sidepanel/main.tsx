import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarClock, ChevronDown, ChevronRight, Download, FileText, KeyRound, Save, Sparkles, Trash2, Wand2, Upload, UserRound } from "lucide-react";
import { draftApplicationFromJobPosting, importProfileFromCv } from "../../lib/ai";
import { db } from "../../lib/db";
import { EMPTY_PROFILE, type AnswerMemory, type Application, type ApplicationStatus, type PendingApplication, type Profile, type Settings } from "../../lib/schema";
import { getPendingApplications, getProfile, getSettings, removePendingApplication, saveProfile, saveSettings } from "../../lib/storage";
import "./styles.css";

const statuses: ApplicationStatus[] = ["Saved", "Applied", "Screen", "Interview", "Offer", "Rejected", "Ghosted"];

function App() {
  const [tab, setTab] = useState<"profile" | "tracker" | "memory" | "settings">("profile");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [pendingApplications, setPendingApplications] = useState<PendingApplication[]>([]);
  const [memories, setMemories] = useState<AnswerMemory[]>([]);
  const [savedAt, setSavedAt] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [autofillStatus, setAutofillStatus] = useState("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setProfile(await getProfile());
    setSettings(await getSettings());
    setApplications(await db.applications.orderBy("dateApplied").reverse().toArray());
    setPendingApplications(await getPendingApplications());
    setMemories(await db.answerMemory.orderBy("lastUsed").reverse().toArray());
  }

  async function persistProfile() {
    await saveProfile(profile);
    setSavedAt(new Date().toLocaleTimeString());
  }

  async function persistSettings(next: Settings) {
    setSettings(next);
    await saveSettings(next);
  }

  async function importCv(file: File) {
    try {
      if (!settings?.apiKey) throw new Error("Add your OpenAI API key in Settings first.");
      setImportStatus("Reading CV...");
      const fileDataUrl = await readFileDataUrl(file);
      setImportStatus("Asking OpenAI...");
      const draft = await importProfileFromCv(file.name, fileDataUrl, profile, settings);
      setProfile(draft);
      await saveProfile(draft);
      setSavedAt(new Date().toLocaleTimeString());
      setImportStatus("Profile imported and saved for autofill.");
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function autofillCurrentPage() {
    setAutofillStatus("Autofilling...");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active page tab found.");
      const response = await sendAutofillMessage(tab.id);
      if (!response?.ok) throw new Error(response?.error ?? "Autofill failed.");
      setAutofillStatus(response.resumeOpened ? `Filled ${response.filled} fields and opened resume picker.` : `Filled ${response.filled} fields.`);
    } catch (error) {
      setAutofillStatus(error instanceof Error ? error.message : String(error));
    }
  }

  const dueCount = applications.filter((app) => app.nextActionDate && new Date(app.nextActionDate) <= new Date()).length;
  const weekCount = applications.filter((app) => Date.now() - new Date(app.dateApplied).getTime() < 7 * 24 * 60 * 60 * 1000).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local-first job ops</p>
          <h1>Autofill desk</h1>
        </div>
        <button className="iconButton" title="Save profile" onClick={persistProfile}>
          <Save size={17} />
        </button>
      </header>

      <section className="metrics">
        <Metric label="This week" value={weekCount} />
        <Metric label="Due" value={dueCount} />
        <Metric label="Memory" value={memories.length} />
      </section>

      <section className="quickActions">
        <button onClick={() => void autofillCurrentPage()}>
          <Wand2 size={16} />
          Autofill current page
        </button>
        {autofillStatus && <span>{autofillStatus}</span>}
      </section>

      <nav className="tabs">
        <Tab active={tab === "profile"} onClick={() => setTab("profile")} icon={<UserRound size={15} />} label="Profile" />
        <Tab active={tab === "tracker"} onClick={() => setTab("tracker")} icon={<CalendarClock size={15} />} label="Tracker" />
        <Tab active={tab === "memory"} onClick={() => setTab("memory")} icon={<FileText size={15} />} label="Answers" />
        <Tab active={tab === "settings"} onClick={() => setTab("settings")} icon={<KeyRound size={15} />} label="Settings" />
      </nav>

      {tab === "profile" && (
        <ProfilePanel
          profile={profile}
          setProfile={setProfile}
          savedAt={savedAt}
          importStatus={importStatus}
          onImportCv={importCv}
          onSave={persistProfile}
        />
      )}
      {tab === "tracker" && <TrackerPanel applications={applications} pendingApplications={pendingApplications} refresh={refresh} />}
      {tab === "memory" && <MemoryPanel memories={memories} />}
      {tab === "settings" && settings && <SettingsPanel settings={settings} save={persistSettings} />}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button className={active ? "tab active" : "tab"} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function ProfilePanel({
  profile,
  setProfile,
  savedAt,
  importStatus,
  onImportCv,
  onSave
}: {
  profile: Profile;
  setProfile: (profile: Profile) => void;
  savedAt: string;
  importStatus: string;
  onImportCv: (file: File) => Promise<void>;
  onSave: () => Promise<void>;
}) {
  const skillsText = useMemo(
    () =>
      Object.entries(profile.skills)
        .map(([name, fact]) => `${name}|${fact.years}|${fact.note}${fact.services?.length ? `|${fact.services.join(",")}` : ""}`)
        .join("\n"),
    [profile.skills]
  );
  const experienceText = useMemo(
    () =>
      profile.experience
        .map((item) =>
          [
            `${item.title}|${item.company}|${item.start}|${item.end}`,
            item.highlights.join("; "),
            item.stack.join(", ")
          ].join("\n")
        )
        .join("\n\n"),
    [profile.experience]
  );

  function update(path: string, value: string | boolean) {
    const clone = structuredClone(profile);
    const keys = path.split(".");
    let cursor: Record<string, unknown> = clone as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
    cursor[keys.at(-1)!] = value;
    setProfile(clone);
  }

  function updateSkills(value: string) {
    const skills: Profile["skills"] = {};
    for (const line of value.split("\n")) {
      if (!line.trim()) continue;
      const [name, years, note, services] = line.split("|");
      skills[name.trim()] = {
        years: Number(years),
        note: note?.trim() ?? "",
        services: services?.split(",").map((item) => item.trim()).filter(Boolean)
      };
    }
    setProfile({ ...profile, skills });
  }

  function updateExperience(value: string) {
    const experience = value
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const [header = "", highlightsLine = "", stackLine = ""] = block.split("\n");
        const [title = "", company = "", start = "", end = ""] = header.split("|");
        return {
          title: title.trim(),
          company: company.trim(),
          start: start.trim(),
          end: end.trim(),
          highlights: highlightsLine.split(";").map((item) => item.trim()).filter(Boolean),
          stack: stackLine.split(",").map((item) => item.trim()).filter(Boolean)
        };
      });
    setProfile({ ...profile, experience });
  }

  async function importSelectedCv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await onImportCv(file);
  }

  return (
    <section className="panel">
      <div className="sectionHeader">
        <div>
          <h2>Master profile</h2>
          <p>Canonical facts only. Importing a CV creates a reviewable draft before you save.</p>
        </div>
        {savedAt && <span className="saveStamp">Saved {savedAt}</span>}
      </div>

      <label className="importCv">
        <Upload size={16} />
        <span>Import CV PDF</span>
        <input type="file" accept="application/pdf" onChange={(event) => void importSelectedCv(event)} />
      </label>
      <button className="saveProfileButton" onClick={() => void onSave()}>
        <Save size={16} />
        Save profile for autofill
      </button>
      {importStatus && <p className="saveStamp">{importStatus}</p>}

      <div className="grid two">
        <Field label="First name" value={profile.identity.firstName} onChange={(value) => update("identity.firstName", value)} />
        <Field label="Last name" value={profile.identity.lastName} onChange={(value) => update("identity.lastName", value)} />
        <Field label="Email" value={profile.identity.email} onChange={(value) => update("identity.email", value)} />
        <Field label="Phone" value={profile.identity.phone} onChange={(value) => update("identity.phone", value)} />
        <Field label="City" value={profile.identity.location.city} onChange={(value) => update("identity.location.city", value)} />
        <Field label="State" value={profile.identity.location.state ?? "Tamaulipas"} onChange={(value) => update("identity.location.state", value)} />
        <Field label="Country" value={profile.identity.location.country} onChange={(value) => update("identity.location.country", value)} />
      </div>

      <div className="grid">
        <Field label="LinkedIn" value={profile.identity.links.linkedin} onChange={(value) => update("identity.links.linkedin", value)} />
        <Field label="GitHub" value={profile.identity.links.github} onChange={(value) => update("identity.links.github", value)} />
        <Field label="Portfolio" value={profile.identity.links.portfolio} onChange={(value) => update("identity.links.portfolio", value)} />
      </div>

      <div className="toggles">
        <label><input type="checkbox" checked={profile.workAuthorization.usAuthorized} onChange={(event) => update("workAuthorization.usAuthorized", event.target.checked)} /> US authorized</label>
        <label><input type="checkbox" checked={profile.workAuthorization.requiresSponsorship} onChange={(event) => update("workAuthorization.requiresSponsorship", event.target.checked)} /> Needs sponsorship</label>
      </div>

      <Field label="English proficiency" value={profile.workAuthorization.englishProficiency} onChange={(value) => update("workAuthorization.englishProficiency", value)} />
      <label className="field">
        <span>Skills, one per line: name|years|note|services</span>
        <textarea rows={6} value={skillsText} onChange={(event) => updateSkills(event.target.value)} />
      </label>
      <label className="field">
        <span>Experience, one block per company: title|company|start|end, then responsibilities, then stack</span>
        <textarea rows={10} value={experienceText} onChange={(event) => updateExperience(event.target.value)} />
      </label>
    </section>
  );
}

function TrackerPanel({
  applications,
  pendingApplications,
  refresh
}: {
  applications: Application[];
  pendingApplications: PendingApplication[];
  refresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [postingText, setPostingText] = useState("");
  const [parseStatus, setParseStatus] = useState("");
  const filtered = applications.filter((app) => `${app.company} ${app.role} ${app.status} ${app.source}`.toLowerCase().includes(query.toLowerCase()));

  async function addManual() {
    await db.applications.add({
      company: "Company",
      role: "Role",
      jobUrl: "",
      source: "Manual",
      dateApplied: new Date().toISOString(),
      status: "Applied",
      location: "",
      workMode: "",
      jobDescription: "",
      answersUsed: [],
      notes: ""
    });
    await refresh();
  }

  function exportCsv() {
    const rows = [["company", "role", "status", "source", "dateApplied", "nextActionDate", "location", "workMode", "jobUrl", "jobDescription", "notes"]];
    for (const app of applications) rows.push([
      app.company,
      app.role,
      app.status,
      app.source,
      app.dateApplied,
      app.nextActionDate ?? "",
      app.location ?? "",
      app.workMode ?? "",
      app.jobUrl,
      app.jobDescription ?? "",
      app.notes
    ]);
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    chrome.downloads?.download?.({ url, filename: "job-applications.csv", saveAs: true });
  }

  async function trackPending(pending: PendingApplication) {
    await db.applications.add(pending.application);
    await removePendingApplication(pending.id);
    await refresh();
  }

  async function skipPending(pending: PendingApplication) {
    await removePendingApplication(pending.id);
    await refresh();
  }

  async function parsePosting() {
    setParseStatus("Reading posting...");
    try {
      const settings = await getSettings();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const draft = await draftApplicationFromJobPosting(postingText, settings, tab?.url ?? "");
      await db.applications.add({
        company: draft.company,
        role: draft.role,
        jobUrl: draft.jobUrl || tab?.url || "",
        source: draft.source || "Pasted",
        dateApplied: new Date().toISOString(),
        status: "Saved",
        location: draft.location,
        workMode: draft.workMode,
        jobDescription: draft.jobDescription,
        answersUsed: [],
        notes: ""
      });
      setPostingText("");
      setPasteOpen(false);
      setParseStatus("");
      await refresh();
    } catch (error) {
      setParseStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="panel">
      <div className="toolbar">
        <input placeholder="Search applications" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button onClick={addManual}>Add</button>
        <button onClick={() => setPasteOpen(!pasteOpen)}>Paste</button>
        <button className="iconButton" title="Export CSV" onClick={exportCsv}><Download size={16} /></button>
      </div>
      {pasteOpen && (
        <section className="pasteJobPanel">
          <label>
            <span>Paste job posting</span>
            <textarea rows={8} value={postingText} onChange={(event) => setPostingText(event.target.value)} />
          </label>
          <div className="pasteActions">
            {parseStatus && <span>{parseStatus}</span>}
            <button onClick={() => void parsePosting()}>Create with AI</button>
          </div>
        </section>
      )}
      {pendingApplications.length > 0 && (
        <div className="pendingList">
          {pendingApplications.map((pending) => (
            <article className="pendingApplication" key={pending.id}>
              <div>
                <strong>Track this application?</strong>
                <p>{pending.application.company} - {pending.application.role}</p>
                <small>{pending.application.source} | Applied | {new Date(pending.application.dateApplied).toLocaleString()}</small>
              </div>
              <div className="pendingActions">
                <button onClick={() => void skipPending(pending)}>Skip</button>
                <button className="primary" onClick={() => void trackPending(pending)}>Track</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="applicationList">
        <div className="appListHeader">
          <span>Company</span>
          <span>Role</span>
          <span>Status</span>
          <span>Applied</span>
          <span>Next</span>
        </div>
        {filtered.length === 0 && <Empty icon={<CalendarClock size={19} />} title="No applications found" body="Tracked and manual applications will appear here." />}
        {filtered.map((app) => <ApplicationRow app={app} refresh={refresh} key={app.id} />)}
      </div>
    </section>
  );
}

function ApplicationRow({ app, refresh }: { app: Application; refresh: () => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);

  async function update(patch: Partial<Application>) {
    await db.applications.update(app.id!, patch);
    await refresh();
  }

  async function remove() {
    if (!app.id) return;
    await db.applications.delete(app.id);
    await refresh();
  }

  return (
    <article className={expanded ? "appRow expanded" : "appRow"}>
      <div className="appSummary">
        <button className="rowIconButton" title={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <div>
          <strong>{app.company || "Company"}</strong>
          <p>{app.role || "Role"}</p>
          <small>{app.status} | {dateInputValue(app.dateApplied)} | {app.source}</small>
          {(app.location || app.workMode) && <small>{[app.location, app.workMode].filter(Boolean).join(" | ")}</small>}
        </div>
        <button className="rowIconButton danger" title="Delete application" onClick={() => void remove()}>
          <Trash2 size={15} />
        </button>
      </div>

      {expanded && (
        <div className="appDetails">
          <label>
            <span>Company</span>
            <input value={app.company} onChange={(event) => void update({ company: event.target.value })} />
          </label>
          <label>
            <span>Role</span>
            <input value={app.role} onChange={(event) => void update({ role: event.target.value })} />
          </label>
          <select value={app.status} onChange={(event) => void update({ status: event.target.value as ApplicationStatus })}>
            {statuses.map((status) => <option key={status}>{status}</option>)}
          </select>
          <label>
            <span>Applied date</span>
            <input type="date" value={dateInputValue(app.dateApplied)} onChange={(event) => void update({ dateApplied: dateToIso(event.target.value) })} />
          </label>
          <label>
            <span>Follow-up date</span>
            <input type="date" value={app.nextActionDate?.slice(0, 10) ?? ""} onChange={(event) => void update({ nextActionDate: event.target.value })} />
          </label>
          <label>
            <span>Location</span>
            <input value={app.location ?? ""} onChange={(event) => void update({ location: event.target.value })} />
          </label>
          <label>
            <span>Work mode</span>
            <select value={app.workMode ?? ""} onChange={(event) => void update({ workMode: event.target.value as Application["workMode"] })}>
              <option value="">Unknown</option>
              <option value="Remote">Remote</option>
              <option value="Hybrid">Hybrid</option>
              <option value="On-site">On-site</option>
            </select>
          </label>
          <label>
            <span>Job description</span>
            <textarea rows={5} value={app.jobDescription ?? ""} onChange={(event) => void update({ jobDescription: event.target.value })} />
          </label>
          <small>{app.source}</small>
        </div>
      )}
    </article>
  );
}

function dateInputValue(value: string | undefined): string {
  if (!value) return todayInputDate();
  return value.slice(0, 10);
}

function dateToIso(value: string): string {
  if (!value) return new Date().toISOString();
  return new Date(`${value}T12:00:00`).toISOString();
}

function todayInputDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function MemoryPanel({ memories }: { memories: AnswerMemory[] }) {
  return (
    <section className="panel answerList">
      {memories.length === 0 && <Empty icon={<Sparkles size={19} />} title="No remembered answers yet" body="Approved AI drafts and reused free-text answers will appear here." />}
      {memories.map((memory) => (
        <article className="answer" key={memory.id}>
          <strong>{memory.questionText}</strong>
          <p>{memory.answer}</p>
        </article>
      ))}
    </section>
  );
}

function SettingsPanel({ settings, save }: { settings: Settings; save: (settings: Settings) => Promise<void> }) {
  return (
    <section className="panel">
      <div className="toggles">
        <label><input type="checkbox" checked={settings.aiEnabled} onChange={(event) => void save({ ...settings, aiEnabled: event.target.checked })} /> AI drafts</label>
      </div>
      <Field label="OpenAI API key" type="password" value={settings.apiKey} onChange={(value) => void save({ ...settings, apiKey: value })} />
      <Field label="Model" value={settings.model} onChange={(value) => void save({ ...settings, model: value })} />
      <div className="siteGrid">
        {Object.entries(settings.enabledSites).map(([site, enabled]) => (
          <label key={site}><input type="checkbox" checked={enabled} onChange={(event) => void save({ ...settings, enabledSites: { ...settings.enabledSites, [site]: event.target.checked } })} /> {site}</label>
        ))}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Empty({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="empty">
      {icon}
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to read CV PDF."));
        return;
      }
      resolve(reader.result);
    });
    reader.addEventListener("error", () => reject(new Error("Unable to read CV PDF.")));
    reader.readAsDataURL(file);
  });
}

async function sendAutofillMessage(tabId: number): Promise<{ ok: boolean; filled?: number; resumeOpened?: boolean; error?: string }> {
  try {
    return await chrome.tabs.sendMessage(tabId, { kind: "AUTOFILL_CURRENT_FORM" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!detail.includes("Receiving end does not exist")) throw error;
  }

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content-scripts/content.js"]
  });
  await wait(150);
  return await chrome.tabs.sendMessage(tabId, { kind: "AUTOFILL_CURRENT_FORM" });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

createRoot(document.getElementById("root")!).render(<App />);
