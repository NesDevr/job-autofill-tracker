import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BriefcaseBusiness, Building2, CalendarClock, ChevronDown, ChevronRight, Download, FileText, KeyRound, ListFilter, MapPin, Plus, Save, Search, Sparkles, Trash2, Upload, UserRound, Wand2, X } from "lucide-react";
import { draftApplicationFromJobPosting, draftSingleAnswer, importProfileFromCv } from "../../lib/ai";
import { normalizeCompensationCurrency } from "../../lib/compensation";
import { db } from "../../lib/db";
import { questionHash } from "../../lib/mapping";
import { EMPTY_PROFILE, type AnswerMemory, type Application, type ApplicationStatus, type CompensationCurrency, type CompensationPeriod, type PendingApplication, type Profile, type Settings, type ThemeMode } from "../../lib/schema";
import { clearDashboardLaunch, getDashboardLaunch, getPendingApplications, getProfile, getSettings, removePendingApplication, saveProfile, saveSettings } from "../../lib/storage";
import { applyTheme } from "../../lib/theme";
import "./styles.css";

const statuses: ApplicationStatus[] = ["Saved", "Applied", "Screen", "Interview", "Offer", "Rejected", "Ghosted"];
const defaultBoardStatuses: ApplicationStatus[] = ["Applied", "Interview", "Rejected"];

function App() {
  const [tab, setTab] = useState<"profile" | "tracker" | "memory" | "settings">("profile");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [pendingApplications, setPendingApplications] = useState<PendingApplication[]>([]);
  const [memories, setMemories] = useState<AnswerMemory[]>([]);
  const [profileSaveStatus, setProfileSaveStatus] = useState("Saved");
  const [importStatus, setImportStatus] = useState("");
  const [launchPendingId, setLaunchPendingId] = useState<string | undefined>();
  const skipNextProfileSave = useRef(true);
  const profileSaveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void loadInitialState();

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      if (changes.pendingApplications) void refresh();
      if (changes.dashboardLaunch) void consumeDashboardLaunch();
      if (changes.settings) void refresh();
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    if (skipNextProfileSave.current) {
      skipNextProfileSave.current = false;
      return;
    }

    window.clearTimeout(profileSaveTimer.current);
    setProfileSaveStatus("Saving...");
    profileSaveTimer.current = window.setTimeout(() => {
      void saveProfile(profile)
        .then(() => setProfileSaveStatus(`Saved ${new Date().toLocaleTimeString()}`))
        .catch((error: unknown) => setProfileSaveStatus(error instanceof Error ? error.message : String(error)));
    }, 550);

    return () => window.clearTimeout(profileSaveTimer.current);
  }, [profile]);

  async function loadInitialState() {
    await refresh();
    await consumeDashboardLaunch();
  }

  async function consumeDashboardLaunch() {
    const launch = await getDashboardLaunch();
    if (!launch) return;
    setTab(launch.tab);
    setLaunchPendingId(launch.pendingId);
    await clearDashboardLaunch();
  }

  async function refresh() {
    const nextSettings = await getSettings();
    skipNextProfileSave.current = true;
    setProfile(await getProfile());
    setSettings(nextSettings);
    applyTheme(nextSettings.theme);
    setApplications(await db.applications.orderBy("dateApplied").reverse().toArray());
    setPendingApplications(await getPendingApplications());
    setMemories(await db.answerMemory.orderBy("lastUsed").reverse().toArray());
  }

  async function persistSettings(next: Settings) {
    setSettings(next);
    applyTheme(next.theme);
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
      setProfileSaveStatus(`Saved ${new Date().toLocaleTimeString()}`);
      setImportStatus("Profile imported and saved for autofill.");
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : String(error));
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
      </header>

      <section className="metrics">
        <Metric label="This week" value={weekCount} />
        <Metric label="Due" value={dueCount} />
        <Metric label="Memory" value={memories.length} />
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
          saveStatus={profileSaveStatus}
          importStatus={importStatus}
          onImportCv={importCv}
        />
      )}
      {tab === "tracker" && (
        <TrackerPanel
          applications={applications}
          pendingApplications={pendingApplications}
          refresh={refresh}
          launchPendingId={launchPendingId}
          onLaunchConsumed={() => setLaunchPendingId(undefined)}
        />
      )}
      {tab === "memory" && <MemoryPanel memories={memories} refresh={refresh} />}
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
  saveStatus,
  importStatus,
  onImportCv
}: {
  profile: Profile;
  setProfile: (profile: Profile) => void;
  saveStatus: string;
  importStatus: string;
  onImportCv: (file: File) => Promise<void>;
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
          <p>Canonical facts only. Changes save automatically.</p>
        </div>
        <span className="saveStamp">{saveStatus}</span>
      </div>

      <label className="importCv">
        <Upload size={16} />
        <span>Import CV PDF</span>
        <input type="file" accept="application/pdf" onChange={(event) => void importSelectedCv(event)} />
      </label>
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
  refresh,
  launchPendingId,
  onLaunchConsumed
}: {
  applications: Application[];
  pendingApplications: PendingApplication[];
  refresh: () => Promise<void>;
  launchPendingId?: string;
  onLaunchConsumed: () => void;
}) {
  const [query, setQuery] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState({
    company: "",
    role: "",
    jobUrl: "",
    source: "Manual",
    status: "Applied" as ApplicationStatus,
    compensationText: "",
    compensationCurrency: "" as CompensationCurrency,
    compensationMin: "",
    compensationMax: "",
    compensationPeriod: "" as CompensationPeriod
  });
  const [pasteOpen, setPasteOpen] = useState(false);
  const [postingText, setPostingText] = useState("");
  const [parseStatus, setParseStatus] = useState("");
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [visibleStatuses, setVisibleStatuses] = useState<ApplicationStatus[]>(defaultBoardStatuses);
  const [activePendingId, setActivePendingId] = useState<string | null>(null);
  const filtered = applications.filter((app) => `${app.company} ${app.role} ${app.status} ${app.source}`.toLowerCase().includes(query.toLowerCase()));
  const visibleFiltered = filtered.filter((app) => visibleStatuses.includes(app.status));

  useEffect(() => {
    if (!launchPendingId) return;
    const pending = pendingApplications.find((item) => item.id === launchPendingId);
    if (!pending) return;
    openPendingPaste(pending);
    onLaunchConsumed();
  }, [launchPendingId, pendingApplications, onLaunchConsumed]);

  function toggleVisibleStatus(status: ApplicationStatus) {
    setVisibleStatuses((current) => (
      current.includes(status)
        ? current.filter((item) => item !== status)
        : statuses.filter((item) => item === status || current.includes(item))
    ));
  }

  async function moveApplication(id: number, status: ApplicationStatus) {
    await db.applications.update(id, { status });
    setDraggedId(null);
    await refresh();
  }

  async function addManual() {
    if (!manualDraft.company.trim() || !manualDraft.role.trim()) {
      setParseStatus("Company and role are required.");
      return;
    }

    await db.applications.add({
      company: manualDraft.company.trim(),
      role: manualDraft.role.trim(),
      jobUrl: manualDraft.jobUrl.trim(),
      source: manualDraft.source.trim(),
      dateApplied: new Date().toISOString(),
      status: manualDraft.status,
      location: "",
      workMode: "",
      compensation: compensationFromDraft(manualDraft),
      jobDescription: "",
      answersUsed: [],
      notes: ""
    });
    setManualDraft({
      company: "",
      role: "",
      jobUrl: "",
      source: "Manual",
      status: "Applied",
      compensationText: "",
      compensationCurrency: "",
      compensationMin: "",
      compensationMax: "",
      compensationPeriod: ""
    });
    setManualOpen(false);
    setParseStatus("");
    await refresh();
  }

  function exportCsv() {
    const rows = [["company", "role", "status", "source", "dateApplied", "nextActionDate", "location", "workMode", "compensation", "compensationCurrency", "compensationMin", "compensationMax", "compensationPeriod", "jobUrl", "jobDescription", "notes"]];
    for (const app of applications) rows.push([
      app.company,
      app.role,
      app.status,
      app.source,
      app.dateApplied,
      app.nextActionDate ?? "",
      app.location ?? "",
      app.workMode ?? "",
      app.compensation?.text ?? "",
      app.compensation?.currency ?? "",
      app.compensation?.min == null ? "" : String(app.compensation.min),
      app.compensation?.max == null ? "" : String(app.compensation.max),
      app.compensation?.period ?? "",
      app.jobUrl,
      app.jobDescription ?? "",
      app.notes
    ]);
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    chrome.downloads?.download?.({ url, filename: "job-applications.csv", saveAs: true });
  }

  async function skipPending(pending: PendingApplication) {
    await removePendingApplication(pending.id);
    await refresh();
  }

  function openPendingPaste(pending: PendingApplication) {
    setManualOpen(false);
    setPasteOpen(true);
    setActivePendingId(pending.id);
    setPostingText(applicationToPasteText(pending.application));
    setParseStatus("Review or add anything before creating with AI.");
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
        status: "Applied",
        location: draft.location,
        workMode: draft.workMode,
        compensation: draft.compensation,
        jobDescription: draft.jobDescription,
        answersUsed: [],
        notes: ""
      });
      if (activePendingId) {
        await removePendingApplication(activePendingId);
        setActivePendingId(null);
      }
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
      <div className="toolbar trackerToolbar">
        <label className="searchBox">
          <Search size={15} />
          <input aria-label="Search applications" placeholder="Search roles or companies" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button onClick={() => setManualOpen(!manualOpen)}>Add</button>
        <button onClick={() => setPasteOpen(!pasteOpen)}>Paste</button>
        <button className="iconButton" title="Export CSV" onClick={exportCsv}><Download size={16} /></button>
      </div>
      {manualOpen && (
        <section className="manualJobPanel">
          <div className="grid two">
            <Field label="Company" value={manualDraft.company} onChange={(value) => setManualDraft({ ...manualDraft, company: value })} />
            <Field label="Role" value={manualDraft.role} onChange={(value) => setManualDraft({ ...manualDraft, role: value })} />
            <Field label="Job URL" value={manualDraft.jobUrl} onChange={(value) => setManualDraft({ ...manualDraft, jobUrl: value })} />
            <Field label="Source" value={manualDraft.source} onChange={(value) => setManualDraft({ ...manualDraft, source: value })} />
            <Field label="Compensation" value={manualDraft.compensationText} onChange={(value) => setManualDraft({ ...manualDraft, compensationText: value })} />
            <Field label="Min" value={manualDraft.compensationMin} onChange={(value) => setManualDraft({ ...manualDraft, compensationMin: value })} />
            <Field label="Max" value={manualDraft.compensationMax} onChange={(value) => setManualDraft({ ...manualDraft, compensationMax: value })} />
          </div>
          <div className="pasteActions">
            {parseStatus && <span>{parseStatus}</span>}
            <select value={manualDraft.compensationCurrency} onChange={(event) => setManualDraft({ ...manualDraft, compensationCurrency: event.target.value as CompensationCurrency })}>
              <option value="">Currency</option>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
            <select value={manualDraft.compensationPeriod} onChange={(event) => setManualDraft({ ...manualDraft, compensationPeriod: event.target.value as CompensationPeriod })}>
              <option value="">Period</option>
              <option value="year">Year</option>
              <option value="month">Month</option>
              <option value="hour">Hour</option>
              <option value="one-time">One-time</option>
            </select>
            <select value={manualDraft.status} onChange={(event) => setManualDraft({ ...manualDraft, status: event.target.value as ApplicationStatus })}>
              {statuses.map((status) => <option key={status}>{status}</option>)}
            </select>
            <button onClick={() => void addManual()}>Create</button>
          </div>
        </section>
      )}
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
                <strong>Paste AI draft ready</strong>
                <p>{pending.application.company} - {pending.application.role}</p>
                <small>{pending.application.source} | Review before saving | {new Date(pending.application.dateApplied).toLocaleString()}</small>
              </div>
              <div className="pendingActions">
                <button onClick={() => void skipPending(pending)}>Dismiss</button>
                <button className="primary" onClick={() => openPendingPaste(pending)}>Paste AI</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {filtered.length === 0 && <Empty icon={<CalendarClock size={19} />} title="No applications found" body="Tracked and manual applications will appear here." />}
      <div className="statusFilter" aria-label="Visible board statuses">
        <span><ListFilter size={14} /> Statuses</span>
        <div className="statusFilterChips">
          {statuses.map((status) => {
            const statusCount = filtered.filter((app) => app.status === status).length;
            return (
              <button
                className={visibleStatuses.includes(status) ? "statusChip active" : "statusChip"}
                key={status}
                type="button"
                aria-pressed={visibleStatuses.includes(status)}
                onClick={() => toggleVisibleStatus(status)}
              >
                <span className={`statusDot status-${status.toLowerCase()}`} />
                {status}
                <strong>{statusCount}</strong>
              </button>
            );
          })}
        </div>
        <div className="statusFilterActions">
          <button type="button" onClick={() => setVisibleStatuses(defaultBoardStatuses)}>Core</button>
          <button type="button" onClick={() => setVisibleStatuses(statuses)}>All</button>
        </div>
      </div>
      {visibleStatuses.length === 0 && filtered.length > 0 && <Empty icon={<ListFilter size={19} />} title="No statuses selected" body="Choose at least one status to show matching applications." />}
      {visibleFiltered.length === 0 && visibleStatuses.length > 0 && filtered.length > 0 && <Empty icon={<ListFilter size={19} />} title="No visible matches" body="Matching applications are currently in hidden statuses." />}
      {visibleStatuses.length > 0 && (
      <div className="applicationBoard" aria-label="Application pipeline">
        {visibleStatuses.map((status) => {
          const columnApplications = filtered.filter((app) => app.status === status);
          return (
            <section
              className={draggedId !== null ? "boardColumn dragReady" : "boardColumn"}
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => draggedId !== null && void moveApplication(draggedId, status)}
            >
              <header className="boardColumnHeader">
                <span className={`statusDot status-${status.toLowerCase()}`} />
                <h3>{status}</h3>
                <span className="columnCount">{columnApplications.length}</span>
              </header>
              <div className="boardCards">
                {columnApplications.map((app) => (
                  <ApplicationRow
                    app={app}
                    refresh={refresh}
                    variant="card"
                    key={app.id}
                    onDragStart={() => setDraggedId(app.id ?? null)}
                    onDragEnd={() => setDraggedId(null)}
                  />
                ))}
                {columnApplications.length === 0 && <div className="columnEmpty">Drop an application here</div>}
              </div>
            </section>
          );
        })}
      </div>
      )}
    </section>
  );
}

function ApplicationRow({
  app,
  refresh,
  variant = "list",
  onDragStart,
  onDragEnd
}: {
  app: Application;
  refresh: () => Promise<void>;
  variant?: "list" | "card";
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
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
    <article
      className={`${variant === "card" ? "applicationCard" : "appRow"}${expanded ? " expanded" : ""}`}
      draggable={variant === "card" && !expanded}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="appSummary">
        <button className="rowIconButton" title={expanded ? "Collapse" : "Expand"} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <div>
          <strong>{app.role || "Role"}</strong>
          <p><Building2 size={12} /> {app.company || "Company"}</p>
          {variant === "list" && <small>{app.status} | {dateInputValue(app.dateApplied)} | {app.source}</small>}
          {app.compensation?.text && <small>{app.compensation.text}</small>}
          {(app.location || app.workMode) && <small className="cardMeta"><MapPin size={11} /> {[app.location, app.workMode].filter(Boolean).join(" · ")}</small>}
          {variant === "card" && !app.location && !app.workMode && <small className="cardMeta"><BriefcaseBusiness size={11} /> {app.source}</small>}
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
            <span>Compensation</span>
            <input value={app.compensation?.text ?? ""} onChange={(event) => void update({ compensation: { ...(app.compensation ?? emptyCompensation()), text: event.target.value } })} />
          </label>
          <label>
            <span>Currency</span>
            <select value={app.compensation?.currency ?? ""} onChange={(event) => void update({ compensation: { ...(app.compensation ?? emptyCompensation()), currency: event.target.value as CompensationCurrency } })}>
              <option value="">Unknown</option>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <label>
            <span>Comp min</span>
            <input value={app.compensation?.min ?? ""} onChange={(event) => void update({ compensation: { ...(app.compensation ?? emptyCompensation()), min: numberOrUndefined(event.target.value) } })} />
          </label>
          <label>
            <span>Comp max</span>
            <input value={app.compensation?.max ?? ""} onChange={(event) => void update({ compensation: { ...(app.compensation ?? emptyCompensation()), max: numberOrUndefined(event.target.value) } })} />
          </label>
          <label>
            <span>Comp period</span>
            <select value={app.compensation?.period ?? ""} onChange={(event) => void update({ compensation: { ...(app.compensation ?? emptyCompensation()), period: event.target.value as CompensationPeriod } })}>
              <option value="">Unknown</option>
              <option value="year">Year</option>
              <option value="month">Month</option>
              <option value="hour">Hour</option>
              <option value="one-time">One-time</option>
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

function emptyCompensation() {
  return {
    text: "",
    currency: "" as CompensationCurrency,
    min: undefined,
    max: undefined,
    period: "" as CompensationPeriod
  };
}

function compensationFromDraft(draft: {
  compensationText: string;
  compensationCurrency: CompensationCurrency;
  compensationMin: string;
  compensationMax: string;
  compensationPeriod: CompensationPeriod;
}) {
  const text = draft.compensationText.trim();
  const currency = draft.compensationCurrency;
  const min = numberOrUndefined(draft.compensationMin);
  const max = numberOrUndefined(draft.compensationMax);
  if (!text && !currency && min === undefined && max === undefined && !draft.compensationPeriod) return undefined;
  return normalizeCompensationCurrency({
    text,
    currency,
    min,
    max,
    period: draft.compensationPeriod
  });
}

function applicationToPasteText(application: Application): string {
  return [
    `Company: ${application.company}`,
    `Role: ${application.role}`,
    `Job URL: ${application.jobUrl}`,
    `Source: ${application.source}`,
    application.location ? `Location: ${application.location}` : "",
    application.workMode ? `Work mode: ${application.workMode}` : "",
    application.compensation?.text ? `Compensation: ${application.compensation.text}` : "",
    application.jobDescription ? `Job description:\n${application.jobDescription}` : "",
    application.answersUsed.length > 0
      ? `Application answers:\n${application.answersUsed.map((item) => `${item.question}: ${item.answer}`).join("\n")}`
      : ""
  ].filter(Boolean).join("\n\n");
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function dateToIso(value: string): string {
  if (!value) return new Date().toISOString();
  return new Date(`${value}T12:00:00`).toISOString();
}

function todayInputDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function MemoryPanel({ memories, refresh }: { memories: AnswerMemory[]; refresh: () => Promise<void> }) {
  const emptyDraft = { questionText: "", answer: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState(emptyDraft);
  const [status, setStatus] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  async function saveNewAnswer() {
    const questionText = draft.questionText.trim();
    const answer = draft.answer.trim();
    if (!questionText || !answer) {
      setStatus("Question and answer are required.");
      return;
    }

    const hash = questionHash(questionText);
    const existing = await db.answerMemory.where("questionHash").equals(hash).first();
    const payload: AnswerMemory = {
      questionHash: hash,
      questionText,
      answer,
      lastUsed: new Date().toISOString(),
      editable: true
    };

    if (existing?.id) {
      await db.answerMemory.update(existing.id, payload);
      setStatus("Existing answer updated.");
    } else {
      await db.answerMemory.add(payload);
      setStatus("Answer added.");
    }
    setDraft(emptyDraft);
    await refresh();
  }

  async function addWithAi() {
    const questionText = draft.questionText.trim();
    if (!questionText) {
      setStatus("Question is required before using AI.");
      return;
    }

    setAiBusy(true);
    setStatus("Drafting from your profile...");
    try {
      const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
      const answer = await draftSingleAnswer(questionText, profile, settings);
      setDraft({ questionText: "", answer: "" });
      setStatus(`AI answer added: ${answer.slice(0, 70)}${answer.length > 70 ? "..." : ""}`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setAiBusy(false);
    }
  }

  function startEditing(memory: AnswerMemory) {
    if (!memory.id) return;
    setEditingId(memory.id);
    setEditDraft({ questionText: memory.questionText, answer: memory.answer });
    setStatus("");
  }

  async function saveEdit(memory: AnswerMemory) {
    if (!memory.id) return;
    const questionText = editDraft.questionText.trim();
    const answer = editDraft.answer.trim();
    if (!questionText || !answer) {
      setStatus("Question and answer are required.");
      return;
    }
    const hash = questionHash(questionText);
    const existing = await db.answerMemory.where("questionHash").equals(hash).first();
    if (existing?.id && existing.id !== memory.id) {
      setStatus("Another answer already uses that question.");
      return;
    }

    await db.answerMemory.update(memory.id, {
      questionHash: hash,
      questionText,
      answer,
      editable: true
    });
    setEditingId(null);
    setEditDraft(emptyDraft);
    setStatus("Answer saved.");
    await refresh();
  }

  async function deleteAnswer(memory: AnswerMemory) {
    if (!memory.id) return;
    await db.answerMemory.delete(memory.id);
    setStatus("Answer deleted.");
    await refresh();
  }

  return (
    <section className="panel answerList">
      <div className="answerEditor">
        <div className="sectionHeader">
          <div>
            <h2>Answer library</h2>
            <p>Reusable answers for screening questions and repeated application fields.</p>
          </div>
        </div>
        <label>
          <span>Question</span>
          <input value={draft.questionText} onChange={(event) => setDraft({ ...draft, questionText: event.target.value })} />
        </label>
        <label>
          <span>Answer</span>
          <textarea rows={4} value={draft.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} />
        </label>
        <div className="answerEditorActions">
          {status && <span>{status}</span>}
          <button className="ai" disabled={aiBusy} onClick={() => void addWithAi()}>
            <Wand2 size={15} />
            {aiBusy ? "Adding..." : "Add with AI"}
          </button>
          <button onClick={() => void saveNewAnswer()}>
            <Plus size={15} />
            Add answer
          </button>
        </div>
      </div>
      {memories.length === 0 && <Empty icon={<Sparkles size={19} />} title="No remembered answers yet" body="Approved AI drafts and reused free-text answers will appear here." />}
      {memories.map((memory) => (
        <article className="answer" key={memory.id}>
          {editingId === memory.id ? (
            <div className="answerEditForm">
              <label>
                <span>Question</span>
                <input value={editDraft.questionText} onChange={(event) => setEditDraft({ ...editDraft, questionText: event.target.value })} />
              </label>
              <label>
                <span>Answer</span>
                <textarea rows={4} value={editDraft.answer} onChange={(event) => setEditDraft({ ...editDraft, answer: event.target.value })} />
              </label>
              <div className="answerActions">
                <button onClick={() => void saveEdit(memory)}>
                  <Save size={15} />
                  Save
                </button>
                <button onClick={() => setEditingId(null)}>
                  <X size={15} />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="answerHeader">
                <strong>{memory.questionText}</strong>
                <div className="answerActions">
                  <button onClick={() => startEditing(memory)}>Edit</button>
                  <button className="danger" onClick={() => void deleteAnswer(memory)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p>{memory.answer}</p>
            </>
          )}
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
      <label className="field">
        <span>Theme</span>
        <select value={settings.theme} onChange={(event) => void save({ ...settings, theme: event.target.value as ThemeMode })}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
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

createRoot(document.getElementById("root")!).render(<App />);
