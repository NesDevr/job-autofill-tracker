import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BriefcaseBusiness, Building2, CalendarClock, Check, ChevronDown, ChevronRight, Copy, Download, FileText, KeyRound, ListFilter, MapPin, Plus, Save, Search, Sparkles, Trash2, Upload, UserRound, Wand2, X } from "lucide-react";
import { draftApplicationFromJobPosting, draftSingleAnswer, enrichProfileFromText, importProfileFromCv } from "../../lib/ai";
import { normalizeCompensationCurrency } from "../../lib/compensation";
import { createBackup, MAX_BACKUP_BYTES, parseBackupJson, restoreBackup, type FullBackup } from "../../lib/backup";
import { db } from "../../lib/db";
import { createDemoApplications, createDemoMemories } from "../../lib/demo";
import { applicationToClipboardText, localDateISO, localTodayISO } from "../../lib/jobs";
import { questionHash } from "../../lib/mapping";
import { MAX_PROFILE_JSON_BYTES, parseProfileJson, type ProfileImportPreview } from "../../lib/profileImport";
import { APPLICATION_STATUSES, EMPTY_PROFILE, OUTREACH_CONTACT_METHODS, OUTREACH_STATUSES, type AnswerMemory, type Application, type ApplicationStatus, type CompensationCurrency, type CompensationPeriod, type Experience, type OutreachStatus, type PersonalProject, type Profile, type Settings, type ThemeMode, type TrackingEntryMode, type UpworkProposalStatus } from "../../lib/schema";
import { bumpApplicationsRev, clearDashboardLaunch, getDashboardLaunch, getProfile, getSettings, getStoredProfile, saveProfile, saveSettings } from "../../lib/storage";
import { applyTheme } from "../../lib/theme";
import { changeOutreachStatus, opportunityStatus, opportunityType, outreachSummary, type OpportunityType } from "../../lib/outreach";
import { changeUpworkStatus, UPWORK_PROPOSAL_STATUSES, upworkRate, upworkSummary } from "../../lib/upwork";
import "./styles.css";

const statuses = APPLICATION_STATUSES;
const defaultBoardStatuses: ApplicationStatus[] = ["Applied", "Interview", "Rejected"];

function createManualDraft(type: "job" | "outreach" = "job") {
  return {
    type,
    company: "",
    role: "",
    jobUrl: "",
    source: type === "outreach" ? "Local outreach" : "Manual",
    status: "Applied" as ApplicationStatus,
    outreachStatus: "Lead" as OutreachStatus,
    contactName: "",
    contactMethod: "" as NonNullable<Application["outreach"]>["contactMethod"],
    contactDetails: "",
    nextActionDate: "",
    notes: "",
    compensationText: "",
    compensationCurrency: "" as CompensationCurrency,
    compensationMin: "",
    compensationMax: "",
    compensationPeriod: "" as CompensationPeriod
  };
}

function App() {
  const [tab, setTab] = useState<"profile" | "tracker" | "memory" | "settings">("tracker");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [memories, setMemories] = useState<AnswerMemory[]>([]);
  const [profileSaveStatus, setProfileSaveStatus] = useState("Saved");
  const [importStatus, setImportStatus] = useState("");
  const [launchApplicationId, setLaunchApplicationId] = useState<number | undefined>();
  const [backupBusy, setBackupBusy] = useState(false);
  const skipNextProfileSave = useRef(true);
  const profileSaveTimer = useRef<number | undefined>(undefined);
  const profileSaveInFlight = useRef<Promise<void> | undefined>(undefined);
  const settingsSaveInFlight = useRef<Promise<void> | undefined>(undefined);
  const restoringBackup = useRef(false);

  useEffect(() => {
    void loadInitialState();

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      if (restoringBackup.current) return;
      if (changes.dashboardLaunch) void consumeDashboardLaunch();
      if (changes.settings) void refresh();
      if (changes.applicationsRev) void reloadApplications();
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    if (skipNextProfileSave.current) {
      skipNextProfileSave.current = false;
      return;
    }
    if (restoringBackup.current) return;

    if (settings?.demoMode) {
      setProfileSaveStatus("Demo changes are temporary");
      return;
    }

    window.clearTimeout(profileSaveTimer.current);
    setProfileSaveStatus("Saving...");
    profileSaveTimer.current = window.setTimeout(() => {
      const pending = saveProfile(profile);
      profileSaveInFlight.current = pending;
      void pending
        .then(() => setProfileSaveStatus(`Saved ${new Date().toLocaleTimeString()}`))
        .catch((error: unknown) => setProfileSaveStatus(error instanceof Error ? error.message : String(error)));
    }, 550);

    return () => window.clearTimeout(profileSaveTimer.current);
  }, [profile, settings?.demoMode]);

  async function loadInitialState() {
    await refresh();
    await consumeDashboardLaunch();
  }

  async function consumeDashboardLaunch() {
    const launch = await getDashboardLaunch();
    if (!launch) return;
    setTab(launch.tab);
    setLaunchApplicationId(launch.applicationId);
    await clearDashboardLaunch();
  }

  async function refresh() {
    const nextSettings = await getSettings();
    skipNextProfileSave.current = true;
    setProfile(await getProfile());
    setSettings(nextSettings);
    applyTheme(nextSettings.theme);
    if (nextSettings.demoMode) {
      setApplications(createDemoApplications());
      setMemories(createDemoMemories());
      setProfileSaveStatus("Demo changes are temporary");
    } else {
      setApplications(await db.applications.orderBy("dateApplied").reverse().toArray());
      setMemories(await db.answerMemory.orderBy("lastUsed").reverse().toArray());
    }
  }

  // Narrow reload for cross-context application changes (widget drawer in another
  // tab). Deliberately does not touch profile state — a full refresh() would
  // clobber in-flight profile edits.
  async function reloadApplications() {
    const nextSettings = await getSettings();
    setApplications(nextSettings.demoMode ? createDemoApplications() : await db.applications.orderBy("dateApplied").reverse().toArray());
  }

  async function persistSettings(next: Settings) {
    const demoModeChanged = next.demoMode !== settings?.demoMode;
    setSettings(next);
    applyTheme(next.theme);
    const pending = saveSettings(next);
    settingsSaveInFlight.current = pending;
    await pending;
    if (demoModeChanged) await refresh();
  }

  async function exportAllData() {
    if (!settings) return;
    const backup = await createBackup(settings.demoMode ? await getStoredProfile() : profile, settings);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    if (blob.size > MAX_BACKUP_BYTES) throw new Error("Backup is larger than the supported 50 MB limit.");
    const url = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({ url, filename: `job-tracker-backup-${backup.exportedAt.slice(0, 10)}.json`, saveAs: true });
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  async function importAllData(backup: FullBackup) {
    restoringBackup.current = true;
    setBackupBusy(true);
    window.clearTimeout(profileSaveTimer.current);
    try {
      // Finish pending edits before taking the rollback snapshot.
      await Promise.allSettled([profileSaveInFlight.current, settingsSaveInFlight.current]);
      if (!settings?.demoMode) await saveProfile(profile);
      await restoreBackup(backup);
      // The restore succeeded even if a refresh signal cannot be written.
      await bumpApplicationsRev().catch(() => undefined);
      try {
        await refresh();
      } catch {
        throw new Error("All data was restored, but the dashboard could not refresh. Reload the dashboard to see your imported data.");
      }
      setProfileSaveStatus(backup.settings.demoMode ? "Demo changes are temporary" : "Saved from backup");
    } finally {
      restoringBackup.current = false;
      setBackupBusy(false);
    }
  }

  async function importCv(file: File) {
    try {
      if (settings?.demoMode) throw new Error("Turn off demo mode before importing a CV.");
      if (!settings?.apiKey) throw new Error("Add your OpenAI API key in Settings first.");
      setImportStatus("Reading CV...");
      const fileDataUrl = await readFileDataUrl(file);
      setImportStatus("Asking OpenAI...");
      const draft = await importProfileFromCv(file.name, fileDataUrl, profile, settings);
      const profileWithResume: Profile = {
        ...draft,
        resumeFileRef: file.name,
        resumeFile: {
          name: file.name,
          type: file.type || "application/pdf",
          dataUrl: fileDataUrl
        }
      };
      setProfile(profileWithResume);
      await saveProfile(profileWithResume);
      setProfileSaveStatus(`Saved ${new Date().toLocaleTimeString()}`);
      setImportStatus("Profile imported and saved for autofill.");
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : String(error));
    }
  }

  const shownApplications = settings?.freelanceOptions ? applications : applications.filter((app) => !app.upwork && !app.outreach);
  const dueCount = shownApplications.filter((app) => app.nextActionDate && new Date(app.nextActionDate) <= new Date()).length;
  const weekCount = shownApplications.filter((app) => Date.now() - new Date(app.dateApplied).getTime() < 7 * 24 * 60 * 60 * 1000).length;
  const todayKey = new Date().toDateString();
  const todayCount = shownApplications.filter((app) => new Date(app.dateApplied).toDateString() === todayKey).length;

  return (
    <main className="shell" inert={backupBusy} aria-busy={backupBusy}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Local-first opportunity ops</p>
          <h1>Autofill desk</h1>
        </div>
        {settings?.demoMode && <span className="demoBadge"><Sparkles size={13} /> Demo mode</span>}
      </header>

      <section className="metrics">
        <Metric label="Today" value={todayCount} />
        <Metric label="Last 7 days" value={weekCount} />
        <Metric label="Due" value={dueCount} />
        <Metric label="Memory" value={memories.length} />
      </section>

      <nav className="tabs">
        <Tab active={tab === "tracker"} onClick={() => setTab("tracker")} icon={<CalendarClock size={15} />} label="Tracker" />
        <Tab active={tab === "profile"} onClick={() => setTab("profile")} icon={<UserRound size={15} />} label="Profile" />
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
          refresh={refresh}
          demoMode={Boolean(settings?.demoMode)}
          freelanceOptions={Boolean(settings?.freelanceOptions)}
          setApplications={setApplications}
          visibleStatuses={settings?.visibleBoardStatuses ?? defaultBoardStatuses}
          onVisibleStatusesChange={(visibleBoardStatuses) => {
            if (!settings) return;
            void persistSettings({ ...settings, visibleBoardStatuses });
          }}
          launchApplicationId={launchApplicationId}
          onLaunchConsumed={() => {
            setLaunchApplicationId(undefined);
          }}
        />
      )}
      {tab === "memory" && <MemoryPanel memories={memories} refresh={refresh} demoMode={Boolean(settings?.demoMode)} setMemories={setMemories} />}
      {tab === "settings" && settings && <SettingsPanel settings={settings} save={persistSettings} exportAll={exportAllData} importAll={importAllData} />}
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
  const [smartAddText, setSmartAddText] = useState("");
  const [smartAddStatus, setSmartAddStatus] = useState("");
  const [smartAdding, setSmartAdding] = useState(false);
  const [jsonImport, setJsonImport] = useState<ProfileImportPreview | null>(null);
  const [jsonImportStatus, setJsonImportStatus] = useState("");

  function update(path: string, value: string | boolean) {
    const { resumeFile, coverLetterFile, ...profileFacts } = profile;
    const clone = {
      ...structuredClone(profileFacts),
      resumeFile,
      coverLetterFile
    } as Profile;
    const keys = path.split(".");
    let cursor: Record<string, unknown> = clone as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
    cursor[keys.at(-1)!] = value;
    setProfile(clone);
  }

  async function smartAdd() {
    if (smartAdding) return;
    setSmartAdding(true);
    setSmartAddStatus("Reading your notes...");
    try {
      const nextProfile = await enrichProfileFromText(smartAddText, profile, await getSettings());
      setProfile(nextProfile);
      setSmartAddText("");
      setSmartAddStatus("Profile updated. Review the sections below.");
    } catch (error) {
      setSmartAddStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSmartAdding(false);
    }
  }

  async function importSelectedCv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await onImportCv(file);
  }

  async function storeCoverLetter(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProfile({
      ...profile,
      coverLetterFile: {
        name: file.name,
        type: file.type || "application/pdf",
        dataUrl: await readFileDataUrl(file)
      }
    });
  }

  async function readProfileJson(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setJsonImport(null);
    try {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error("Choose a .json profile file.");
      if (file.size > MAX_PROFILE_JSON_BYTES) throw new Error("Profile JSON is larger than 1 MB.");
      const preview = parseProfileJson(await file.text(), profile);
      setJsonImport(preview);
      setJsonImportStatus("Validated. Review the summary before applying.");
    } catch (error) {
      setJsonImportStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function applyProfileJson() {
    if (!jsonImport) return;
    setProfile(jsonImport.profile);
    setJsonImport(null);
    setJsonImportStatus("Profile imported. Autosave is updating local storage.");
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

      <div className="smartProfileAdd">
        <div>
          <Sparkles size={16} />
          <span>Smart add</span>
        </div>
        <p>Paste project notes, résumé text, a bio, or facts you want available for applications.</p>
        <textarea
          rows={6}
          placeholder="Paste anything about your work, projects, skills, education, or preferences..."
          value={smartAddText}
          onChange={(event) => setSmartAddText(event.target.value)}
        />
        <button disabled={smartAdding || !smartAddText.trim()} onClick={() => void smartAdd()}>
          <Sparkles size={15} />
          {smartAdding ? "Adding to profile..." : "Add with AI"}
        </button>
        {smartAddStatus && <p className="smartProfileStatus">{smartAddStatus}</p>}
      </div>

      <Section title="Additional answer knowledge" hint="Paste completed Q&As or nuanced facts that do not fit another profile section.">
        <label className="field">
          <span>Facts AI may use in application answers</span>
          <textarea
            rows={10}
            value={profile.additionalKnowledge}
            onChange={(event) => update("additionalKnowledge", event.target.value)}
            placeholder="Example: I advise non-technical fintech clients during implementations..."
          />
        </label>
      </Section>

      <label className="importCv">
        <Upload size={16} />
        <span>Import CV PDF</span>
        <input type="file" accept="application/pdf" onChange={(event) => void importSelectedCv(event)} />
      </label>
      <label className="importCv secondaryUpload">
        <Upload size={16} />
        <span>{profile.coverLetterFile ? `Cover letter: ${profile.coverLetterFile.name}` : "Store cover letter"}</span>
        <input type="file" accept="application/pdf,.doc,.docx" onChange={(event) => void storeCoverLetter(event)} />
      </label>
      <label className="importCv secondaryUpload">
        <Upload size={16} />
        <span>Import Profile JSON</span>
        <input type="file" accept="application/json,.json" onChange={(event) => void readProfileJson(event)} />
      </label>
      {jsonImport && (
        <div className="jsonImportPreview" role="status">
          <strong>{jsonImport.summary.name}</strong>
          <span>{jsonImport.summary.currentRole}</span>
          <span>
            {jsonImport.summary.experienceCount} roles · {jsonImport.summary.projectCount} projects · {jsonImport.summary.skillCount} skills
          </span>
          <p>The imported facts will replace the current profile. Stored CV and cover-letter files will be preserved.</p>
          <div>
            <button type="button" onClick={applyProfileJson}><Check size={15} /> Apply imported profile</button>
            <button type="button" className="secondary" onClick={() => { setJsonImport(null); setJsonImportStatus("Import canceled."); }}><X size={15} /> Cancel</button>
          </div>
        </div>
      )}
      {jsonImportStatus && <p className="saveStamp">{jsonImportStatus}</p>}
      {importStatus && <p className="saveStamp">{importStatus}</p>}

      <Section title="Identity & contact" hint="Reusable facts copied directly into applications.">
        <div className="grid two">
        <Field label="First name" value={profile.identity.firstName} onChange={(value) => update("identity.firstName", value)} />
        <Field label="Middle name" value={profile.identity.middleName} onChange={(value) => update("identity.middleName", value)} />
        <Field label="Last name" value={profile.identity.lastName} onChange={(value) => update("identity.lastName", value)} />
        <Field label="Email" value={profile.identity.email} onChange={(value) => update("identity.email", value)} />
        <Field label="Phone country code" value={profile.identity.phoneCountryCode} onChange={(value) => update("identity.phoneCountryCode", value)} />
        <Field label="Phone" value={profile.identity.phone} onChange={(value) => update("identity.phone", value)} />
        <Field label="Address line 1" value={profile.identity.address.line1} onChange={(value) => update("identity.address.line1", value)} />
        <Field label="Address line 2" value={profile.identity.address.line2} onChange={(value) => update("identity.address.line2", value)} />
        <Field label="ZIP / postal code" value={profile.identity.address.postalCode} onChange={(value) => update("identity.address.postalCode", value)} />
        <Field label="City" value={profile.identity.location.city} onChange={(value) => update("identity.location.city", value)} />
        <Field label="State" value={profile.identity.location.state ?? "Tamaulipas"} onChange={(value) => update("identity.location.state", value)} />
        <Field label="Country" value={profile.identity.location.country} onChange={(value) => update("identity.location.country", value)} />
        <Field label="LinkedIn" value={profile.identity.links.linkedin} onChange={(value) => update("identity.links.linkedin", value)} />
        <Field label="GitHub" value={profile.identity.links.github} onChange={(value) => update("identity.links.github", value)} />
        <Field label="Portfolio" value={profile.identity.links.portfolio} onChange={(value) => update("identity.links.portfolio", value)} />
        </div>
      </Section>

      <Section title="Authorization & application defaults" hint="Explicit reusable answers. Legal declarations are always left for review.">
        <div className="toggles">
          <label><input type="checkbox" checked={profile.workAuthorization.usAuthorized} onChange={(event) => update("workAuthorization.usAuthorized", event.target.checked)} /> US authorized</label>
          <label><input type="checkbox" checked={profile.workAuthorization.requiresSponsorship} onChange={(event) => update("workAuthorization.requiresSponsorship", event.target.checked)} /> Needs sponsorship</label>
          <label><input type="checkbox" checked={profile.applicationDefaults.needsRecruitmentAdjustments} onChange={(event) => update("applicationDefaults.needsRecruitmentAdjustments", event.target.checked)} /> Recruitment adjustments needed</label>
          <label><input type="checkbox" checked={profile.applicationDefaults.previouslyEmployedByFitch} onChange={(event) => update("applicationDefaults.previouslyEmployedByFitch", event.target.checked)} /> Previously employed by Fitch</label>
          <label><input type="checkbox" checked={profile.applicationDefaults.jobNotifications} onChange={(event) => update("applicationDefaults.jobNotifications", event.target.checked)} /> Job notifications</label>
        </div>
        <div className="grid two">
          <Field label="Visa status" value={profile.workAuthorization.visaStatus} onChange={(value) => update("workAuthorization.visaStatus", value)} />
          <Field label="English proficiency" value={profile.workAuthorization.englishProficiency} onChange={(value) => update("workAuthorization.englishProficiency", value)} />
          <Field label="Referral source" value={profile.applicationDefaults.referralSource} onChange={(value) => update("applicationDefaults.referralSource", value)} />
          <Field label="Referral details" value={profile.applicationDefaults.referralDetails} onChange={(value) => update("applicationDefaults.referralDetails", value)} />
          <Field label="Employee referral name" value={profile.applicationDefaults.employeeReferralName} onChange={(value) => update("applicationDefaults.employeeReferralName", value)} />
          <Field label="Recruitment adjustment details" value={profile.applicationDefaults.recruitmentAdjustmentsDetails} onChange={(value) => update("applicationDefaults.recruitmentAdjustmentsDetails", value)} />
          <Field label="Current employer" value={profile.applicationDefaults.currentEmployer} onChange={(value) => update("applicationDefaults.currentEmployer", value)} />
          <Field label="Current title" value={profile.applicationDefaults.currentTitle} onChange={(value) => update("applicationDefaults.currentTitle", value)} />
          <Field label="Current salary" value={profile.applicationDefaults.currentSalary} onChange={(value) => update("applicationDefaults.currentSalary", value)} />
          <Field label="Desired salary" value={profile.applicationDefaults.desiredSalary} onChange={(value) => update("applicationDefaults.desiredSalary", value)} />
          <Field label="Salary currency" value={profile.applicationDefaults.salaryCurrency} onChange={(value) => update("applicationDefaults.salaryCurrency", value)} />
          <label className="field">
            <span>Profile visibility</span>
            <select value={profile.applicationDefaults.profileVisibility} onChange={(event) => update("applicationDefaults.profileVisibility", event.target.value)}>
              <option value="">Review each application</option>
              <option value="Any open role at Fitch">Any open role at Fitch</option>
              <option value="Only for the roles that I directly apply to">Only directly applied roles</option>
            </select>
          </label>
        </div>
      </Section>

      <Section title="Optional demographic answers" hint="Leave blank to keep these questions in the autofill review.">
        <div className="grid two">
          <Field label="Gender" value={profile.demographics.gender} onChange={(value) => update("demographics.gender", value)} />
          <Field label="Ethnic origin" value={profile.demographics.race} onChange={(value) => update("demographics.race", value)} />
          <Field label="Veteran status" value={profile.demographics.veteran} onChange={(value) => update("demographics.veteran", value)} />
          <Field label="Disability disclosure" value={profile.demographics.disability} onChange={(value) => update("demographics.disability", value)} />
        </div>
      </Section>

      <Section title={`Skills (${Object.keys(profile.skills).length})`} hint="Used for affinity scoring, autofill, and drafted screening answers.">
        <SkillsEditor skills={profile.skills} onCommit={(skills) => setProfile({ ...profile, skills })} />
      </Section>

      <Section title={`Experience (${profile.experience.length})`} hint="Used for employer, title, and drafted screening answers.">
        <ExperienceEditor experience={profile.experience} onCommit={(experience) => setProfile({ ...profile, experience })} />
      </Section>

      <Section title={`Personal projects (${profile.personalProjects.length})`} hint="Used for drafted screening answers and affinity scoring.">
        <ProjectsEditor projects={profile.personalProjects} onCommit={(personalProjects) => setProfile({ ...profile, personalProjects })} />
      </Section>
    </section>
  );
}

function TrackerPanel({
  applications,
  refresh,
  demoMode,
  freelanceOptions,
  setApplications,
  visibleStatuses,
  onVisibleStatusesChange,
  launchApplicationId,
  onLaunchConsumed
}: {
  applications: Application[];
  refresh: () => Promise<void>;
  demoMode: boolean;
  freelanceOptions: boolean;
  setApplications: React.Dispatch<React.SetStateAction<Application[]>>;
  visibleStatuses: ApplicationStatus[];
  onVisibleStatusesChange: (statuses: ApplicationStatus[]) => void;
  launchApplicationId?: number;
  onLaunchConsumed: () => void;
}) {
  const [query, setQuery] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(() => createManualDraft());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [upworkOpen, setUpworkOpen] = useState(false);
  const [pipeline, setPipeline] = useState<OpportunityType>("jobs");
  const [visibleOutreachStatuses, setVisibleOutreachStatuses] = useState<OutreachStatus[]>(OUTREACH_STATUSES);
  const [postingText, setPostingText] = useState("");
  const [parseStatus, setParseStatus] = useState("");
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const activePipeline = freelanceOptions ? pipeline : "jobs";
  const pipelineApplications = applications.filter((app) => opportunityType(app) === activePipeline);
  const filtered = pipelineApplications.filter((app) =>
    `${app.company} ${app.role} ${app.status} ${app.source} ${app.outreach?.status ?? ""} ${app.outreach?.contactName ?? ""} ${app.outreach?.contactDetails ?? ""}`
      .toLowerCase().includes(query.toLowerCase())
  );
  const activeStatuses: Array<ApplicationStatus | OutreachStatus> = activePipeline === "outreach" ? visibleOutreachStatuses : visibleStatuses;
  const boardStatuses: Array<ApplicationStatus | OutreachStatus> = activePipeline === "outreach" ? OUTREACH_STATUSES : statuses;
  const visibleFiltered = filtered.filter((app) => activeStatuses.includes(opportunityStatus(app)));
  const upworkStats = upworkSummary(applications);
  const localStats = outreachSummary(applications);

  useEffect(() => {
    if (freelanceOptions) return;
    setPipeline("jobs");
    setManualDraft(createManualDraft("job"));
    setManualOpen(false);
  }, [freelanceOptions]);

  useEffect(() => {
    if (launchApplicationId === undefined) return;
    const application = applications.find((item) => item.id === launchApplicationId);
    if (!application) return;
    setQuery("");
    setPipeline(freelanceOptions ? opportunityType(application) : "jobs");
    if (application.outreach && !visibleOutreachStatuses.includes(application.outreach.status)) {
      setVisibleOutreachStatuses(OUTREACH_STATUSES.filter((status) => status === application.outreach?.status || visibleOutreachStatuses.includes(status)));
    }
    if (!application.outreach && !visibleStatuses.includes(application.status)) {
      onVisibleStatusesChange(statuses.filter((status) => status === application.status || visibleStatuses.includes(status)));
    }
  }, [applications, freelanceOptions, launchApplicationId, onVisibleStatusesChange, visibleOutreachStatuses, visibleStatuses]);

  function toggleVisibleStatus(status: ApplicationStatus) {
    onVisibleStatusesChange(
      visibleStatuses.includes(status)
        ? visibleStatuses.filter((item) => item !== status)
        : statuses.filter((item) => item === status || visibleStatuses.includes(item))
    );
  }

  function toggleVisibleOutreachStatus(status: OutreachStatus) {
    setVisibleOutreachStatuses((current) =>
      current.includes(status)
        ? current.filter((item) => item !== status)
        : OUTREACH_STATUSES.filter((item) => item === status || current.includes(item))
    );
  }

  async function moveApplication(id: number, status: ApplicationStatus | OutreachStatus) {
    const application = applications.find((item) => item.id === id);
    if (!application) throw new Error("Tracked opportunity was not found.");
    const patch = application.outreach
      ? changeOutreachStatus(application, status as OutreachStatus)
      : { status: status as ApplicationStatus };
    if (demoMode) {
      setApplications((current) => current.map((app) => app.id === id ? { ...app, ...patch } : app));
    } else {
      await db.applications.update(id, patch);
      await bumpApplicationsRev();
      await refresh();
    }
    setDraggedId(null);
  }

  async function addManual() {
    if (!freelanceOptions && (manualDraft.type === "outreach" || manualDraft.source.trim().toLowerCase() === "upwork")) {
      setParseStatus("Enable freelance options in Settings to add this opportunity.");
      return;
    }
    if (!manualDraft.company.trim() || !manualDraft.role.trim()) {
      setParseStatus(manualDraft.type === "outreach" ? "Business and service are required." : "Company and role are required.");
      return;
    }

    const application: Application = {
      id: demoMode ? Math.max(0, ...applications.map((app) => app.id ?? 0)) + 1 : undefined,
      company: manualDraft.company.trim(),
      role: manualDraft.role.trim(),
      jobUrl: manualDraft.jobUrl.trim(),
      source: manualDraft.type === "outreach" ? "Local outreach" : manualDraft.source.trim(),
      dateApplied: new Date().toISOString(),
      status: manualDraft.type === "outreach" ? "Saved" : manualDraft.status,
      location: "",
      workMode: "",
      compensation: manualDraft.type === "outreach" ? undefined : compensationFromDraft(manualDraft),
      jobDescription: "",
      answersUsed: [],
      notes: manualDraft.type === "outreach" ? manualDraft.notes.trim() : "",
      nextActionDate: manualDraft.type === "outreach" ? manualDraft.nextActionDate || undefined : undefined,
      upwork: manualDraft.type === "job" && manualDraft.source.trim().toLowerCase() === "upwork" ? {
        status: "Submitted",
        contractType: manualDraft.compensationPeriod === "hour" ? "hourly" : manualDraft.compensationPeriod === "one-time" ? "fixed" : "",
        proposedAmount: numberOrUndefined(manualDraft.compensationMin) ?? null,
        currency: manualDraft.compensationCurrency,
        baseConnects: null,
        boostBid: null,
        boostCharged: null
      } : undefined,
      outreach: manualDraft.type === "outreach" ? {
        status: manualDraft.outreachStatus,
        contactName: manualDraft.contactName.trim(),
        contactMethod: manualDraft.contactMethod,
        contactDetails: manualDraft.contactDetails.trim(),
        contactedAt: manualDraft.outreachStatus === "Lead" ? undefined : new Date().toISOString()
      } : undefined
    };
    if (demoMode) setApplications((current) => [application, ...current]);
    else {
      await db.applications.add(application);
      await bumpApplicationsRev();
    }
    setPipeline(manualDraft.type === "outreach" ? "outreach" : manualDraft.source.trim().toLowerCase() === "upwork" ? "upwork" : "jobs");
    setManualDraft(createManualDraft(manualDraft.type));
    setManualOpen(false);
    setParseStatus("");
    if (!demoMode) await refresh();
  }

  function exportCsv() {
    const rows = [["opportunityType", "company", "roleOrService", "status", "source", "dateAppliedOrAdded", "nextActionDate", "location", "workMode", "compensation", "compensationCurrency", "compensationMin", "compensationMax", "compensationPeriod", "jobUrlOrWebsite", "jobDescription", "notes", "contactName", "contactMethod", "contactDetails", "firstContactedAt", "upworkStatus", "upworkContractType", "upworkProposedAmount", "upworkCurrency", "upworkBaseConnects", "upworkBoostBid", "upworkBoostCharged", "upworkRespondedAt", "upworkInterviewedAt", "upworkOfferedAt", "upworkHiredAt"]];
    for (const app of applications.filter((item) => freelanceOptions || opportunityType(item) === "jobs")) rows.push([
      opportunityType(app),
      app.company,
      app.role,
      app.outreach?.status ?? app.status,
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
      app.notes,
      app.outreach?.contactName ?? "",
      app.outreach?.contactMethod ?? "",
      app.outreach?.contactDetails ?? "",
      app.outreach?.contactedAt ?? "",
      app.upwork?.status ?? "",
      app.upwork?.contractType ?? "",
      app.upwork?.proposedAmount == null ? "" : String(app.upwork.proposedAmount),
      app.upwork?.currency ?? "",
      app.upwork?.baseConnects == null ? "" : String(app.upwork.baseConnects),
      app.upwork?.boostBid == null ? "" : String(app.upwork.boostBid),
      app.upwork?.boostCharged == null ? "" : String(app.upwork.boostCharged),
      app.upwork?.respondedAt ?? "",
      app.upwork?.interviewedAt ?? "",
      app.upwork?.offeredAt ?? "",
      app.upwork?.hiredAt ?? ""
    ]);
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    chrome.downloads?.download?.({ url, filename: "opportunity-tracker.csv", saveAs: true });
  }

  async function parsePosting() {
    setParseStatus("Reading posting...");
    try {
      const settings = await getSettings();
      const draft = await draftApplicationFromJobPosting(postingText, settings);
      if (draft.upwork && !freelanceOptions) throw new Error("Enable freelance options in Settings to add Upwork proposals.");
      const application: Application = {
        id: demoMode ? Math.max(0, ...applications.map((app) => app.id ?? 0)) + 1 : undefined,
        company: draft.company,
        role: draft.role,
        jobUrl: draft.jobUrl,
        source: draft.source || "Pasted",
        dateApplied: new Date().toISOString(),
        status: "Applied",
        location: draft.location,
        workMode: draft.workMode,
        compensation: draft.compensation,
        jobDescription: draft.jobDescription,
        upwork: draft.upwork,
        answersUsed: [],
        notes: ""
      };
      if (demoMode) setApplications((current) => [application, ...current]);
      else {
        await db.applications.add(application);
        await bumpApplicationsRev();
      }
      setPostingText("");
      setPasteOpen(false);
      setParseStatus("");
      if (!demoMode) await refresh();
    } catch (error) {
      setParseStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="panel">
      <div className="pipelineSwitch" aria-label="Opportunity pipeline">
        <button className={pipeline === "jobs" ? "active" : ""} onClick={() => setPipeline("jobs")}>
          Jobs <strong>{applications.filter((app) => opportunityType(app) === "jobs").length}</strong>
        </button>
        {freelanceOptions && <button className={pipeline === "upwork" ? "active" : ""} onClick={() => setPipeline("upwork")}>
          Upwork <strong>{upworkStats.count}</strong>
        </button>}
        {freelanceOptions && <button className={pipeline === "outreach" ? "active outreach" : "outreach"} onClick={() => setPipeline("outreach")}>
          Local outreach <strong>{localStats.count}</strong>
        </button>}
      </div>
      <div className="toolbar trackerToolbar">
        <label className="searchBox">
          <Search size={15} />
          <input aria-label="Search opportunities" placeholder={pipeline === "outreach" ? "Search businesses or contacts" : "Search roles or companies"} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button
          aria-expanded={manualOpen}
          onClick={() => {
            setManualOpen(!manualOpen);
            if (!manualOpen) {
              setPasteOpen(false);
              setManualDraft(pipeline === "outreach" ? createManualDraft("outreach") : { ...createManualDraft(), source: pipeline === "upwork" ? "Upwork" : "Manual" });
            }
          }}
        >
          <Plus size={14} /> {pipeline === "outreach" ? "Add local lead" : "Add manually"}
        </button>
        {pipeline !== "outreach" && <button
          aria-expanded={pasteOpen}
          onClick={() => {
            setPasteOpen(!pasteOpen);
            if (!pasteOpen) setManualOpen(false);
          }}
        >
          <Sparkles size={14} /> Add with AI
        </button>}
        {pipeline === "upwork" && upworkStats.count > 0 && (
          <button
            aria-controls="upwork-summary"
            aria-expanded={upworkOpen}
            onClick={() => setUpworkOpen(!upworkOpen)}
          >
            Upwork {upworkStats.count} {upworkOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        <button className="iconButton" title="Export CSV" onClick={exportCsv}><Download size={16} /></button>
      </div>
      {pipeline === "upwork" && upworkStats.count > 0 && upworkOpen && (
        <section id="upwork-summary" className="upworkSummary" aria-label="Upwork proposal performance">
          <div><span>Upwork proposals</span><strong>{upworkStats.count}</strong></div>
          <div><span>Connects spent</span><strong>{upworkStats.actualConnects}</strong></div>
          <div><span>Responses</span><strong>{upworkStats.responses} · {upworkRate(upworkStats.responses, upworkStats.count)}</strong></div>
          <div><span>Interviews</span><strong>{upworkStats.interviews} · {upworkRate(upworkStats.interviews, upworkStats.count)}</strong></div>
          <div><span>Offers</span><strong>{upworkStats.offers}</strong></div>
          <div><span>Hires</span><strong>{upworkStats.hires}</strong></div>
        </section>
      )}
      {pipeline === "outreach" && localStats.count > 0 && (
        <section className="outreachSummary" aria-label="Local outreach performance">
          <div><span>Local leads</span><strong>{localStats.count}</strong></div>
          <div><span>Contacted</span><strong>{localStats.contacted}</strong></div>
          <div><span>Replies</span><strong>{localStats.replies}</strong></div>
          <div><span>Meetings</span><strong>{localStats.meetings}</strong></div>
          <div><span>Proposals</span><strong>{localStats.proposals}</strong></div>
          <div><span>Won</span><strong>{localStats.wins}</strong></div>
        </section>
      )}
      {manualOpen && (
        <section className="manualJobPanel">
          <div className="manualTypeSwitch">
            <span>Opportunity</span>
            <button className={manualDraft.type === "job" ? "active" : ""} onClick={() => setManualDraft(createManualDraft("job"))}>{freelanceOptions ? "Job / Upwork" : "Job"}</button>
            {freelanceOptions && <button className={manualDraft.type === "outreach" ? "active" : ""} onClick={() => setManualDraft(createManualDraft("outreach"))}>Local outreach</button>}
          </div>
          <div className="grid two">
            <Field label={manualDraft.type === "outreach" ? "Business" : "Company"} value={manualDraft.company} onChange={(value) => setManualDraft({ ...manualDraft, company: value })} />
            <Field label={manualDraft.type === "outreach" ? "Service to offer" : "Role"} value={manualDraft.role} onChange={(value) => setManualDraft({ ...manualDraft, role: value })} />
            <Field label={manualDraft.type === "outreach" ? "Business website" : "Job URL"} value={manualDraft.jobUrl} onChange={(value) => setManualDraft({ ...manualDraft, jobUrl: value })} />
            {manualDraft.type === "outreach" ? (
              <>
                <Field label="Contact name" value={manualDraft.contactName} onChange={(value) => setManualDraft({ ...manualDraft, contactName: value })} />
                <label className="field">
                  <span>Contact method</span>
                  <select value={manualDraft.contactMethod} onChange={(event) => setManualDraft({ ...manualDraft, contactMethod: event.target.value as NonNullable<Application["outreach"]>["contactMethod"] })}>
                    <option value="">Not set</option>
                    {OUTREACH_CONTACT_METHODS.map((method) => <option key={method}>{method}</option>)}
                  </select>
                </label>
                <Field label="Email, phone, or handle" value={manualDraft.contactDetails} onChange={(value) => setManualDraft({ ...manualDraft, contactDetails: value })} />
                <label className="field">
                  <span>Next follow-up</span>
                  <input type="date" value={manualDraft.nextActionDate} onChange={(event) => setManualDraft({ ...manualDraft, nextActionDate: event.target.value })} />
                </label>
              </>
            ) : (
              <>
                <Field label="Source" value={manualDraft.source} onChange={(value) => setManualDraft({ ...manualDraft, source: value })} />
                <Field label="Compensation" value={manualDraft.compensationText} onChange={(value) => setManualDraft({ ...manualDraft, compensationText: value })} />
                <Field label="Min" value={manualDraft.compensationMin} onChange={(value) => setManualDraft({ ...manualDraft, compensationMin: value })} />
                <Field label="Max" value={manualDraft.compensationMax} onChange={(value) => setManualDraft({ ...manualDraft, compensationMax: value })} />
              </>
            )}
          </div>
          {manualDraft.type === "outreach" && (
            <label className="field">
              <span>Notes</span>
              <textarea rows={3} value={manualDraft.notes} onChange={(event) => setManualDraft({ ...manualDraft, notes: event.target.value })} placeholder="What did you notice, and how could you help?" />
            </label>
          )}
          <div className="pasteActions">
            {parseStatus && <span>{parseStatus}</span>}
            {manualDraft.type === "job" && <select value={manualDraft.compensationCurrency} onChange={(event) => setManualDraft({ ...manualDraft, compensationCurrency: event.target.value as CompensationCurrency })}>
              <option value="">Currency</option>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>}
            {manualDraft.type === "job" && <select value={manualDraft.compensationPeriod} onChange={(event) => setManualDraft({ ...manualDraft, compensationPeriod: event.target.value as CompensationPeriod })}>
              <option value="">Period</option>
              <option value="year">Year</option>
              <option value="month">Month</option>
              <option value="hour">Hour</option>
              <option value="one-time">One-time</option>
            </select>}
            {manualDraft.type === "job" ? <select value={manualDraft.status} onChange={(event) => setManualDraft({ ...manualDraft, status: event.target.value as ApplicationStatus })}>
              {statuses.map((status) => <option key={status}>{status}</option>)}
            </select> : <select value={manualDraft.outreachStatus} onChange={(event) => setManualDraft({ ...manualDraft, outreachStatus: event.target.value as OutreachStatus })}>
              {OUTREACH_STATUSES.map((status) => <option key={status}>{status}</option>)}
            </select>}
            <button onClick={() => void addManual()}>Create</button>
          </div>
        </section>
      )}
      {pasteOpen && (
        <section className="pasteJobPanel">
          <label>
            <span>{freelanceOptions ? "Paste job posting or Upwork proposal" : "Paste job posting"} — AI uses only this text</span>
            <textarea rows={8} value={postingText} onChange={(event) => setPostingText(event.target.value)} />
          </label>
          <div className="pasteActions">
            {parseStatus && <span>{parseStatus}</span>}
            <button onClick={() => void parsePosting()}>Create with AI</button>
          </div>
        </section>
      )}
      {filtered.length === 0 && <Empty icon={<CalendarClock size={19} />} title={pipeline === "outreach" ? "No local leads found" : "No applications found"} body={pipeline === "outreach" ? "Add a nearby business you may be able to help." : "Tracked and manual applications will appear here."} />}
      <div className="statusFilter" aria-label="Visible board statuses">
        <span><ListFilter size={14} /> Statuses</span>
        <div className="statusFilterChips">
          {boardStatuses.map((status) => {
            const statusCount = filtered.filter((app) => opportunityStatus(app) === status).length;
            return (
              <button
                className={activeStatuses.includes(status) ? "statusChip active" : "statusChip"}
                key={status}
                type="button"
                aria-pressed={activeStatuses.includes(status)}
                onClick={() => pipeline === "outreach" ? toggleVisibleOutreachStatus(status as OutreachStatus) : toggleVisibleStatus(status as ApplicationStatus)}
              >
                <span className={`statusDot status-${status.toLowerCase().replaceAll(" ", "-")}`} />
                {status}
                <strong>{statusCount}</strong>
              </button>
            );
          })}
        </div>
        <div className="statusFilterActions">
          {pipeline !== "outreach" && <button type="button" onClick={() => onVisibleStatusesChange(defaultBoardStatuses)}>Core</button>}
          <button type="button" onClick={() => pipeline === "outreach" ? setVisibleOutreachStatuses(OUTREACH_STATUSES) : onVisibleStatusesChange(statuses)}>All</button>
        </div>
      </div>
      {activeStatuses.length === 0 && filtered.length > 0 && <Empty icon={<ListFilter size={19} />} title="No statuses selected" body="Choose at least one status to show matching opportunities." />}
      {visibleFiltered.length === 0 && activeStatuses.length > 0 && filtered.length > 0 && <Empty icon={<ListFilter size={19} />} title="No visible matches" body="Matching opportunities are currently in hidden statuses." />}
      {activeStatuses.length > 0 && (
      <div className="applicationBoard" aria-label={pipeline === "outreach" ? "Local outreach pipeline" : "Application pipeline"}>
        {activeStatuses.map((status) => {
          const columnApplications = filtered.filter((app) => opportunityStatus(app) === status);
          return (
            <section
              className={draggedId !== null ? "boardColumn dragReady" : "boardColumn"}
              key={status}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => draggedId !== null && void moveApplication(draggedId, status)}
            >
              <header className="boardColumnHeader">
                <span className={`statusDot status-${status.toLowerCase().replaceAll(" ", "-")}`} />
                <h3>{status}</h3>
                <span className="columnCount">{columnApplications.length}</span>
              </header>
              <div className="boardCards">
                {columnApplications.map((app) => (
                  <ApplicationRow
                    app={app}
                    onUpdate={(patch) => {
                      if (demoMode) setApplications((current) => current.map((item) => item.id === app.id ? { ...item, ...patch } : item));
                      else void db.applications.update(app.id!, patch).then(bumpApplicationsRev).then(refresh);
                    }}
                    onDelete={() => {
                      if (demoMode) setApplications((current) => current.filter((item) => item.id !== app.id));
                      else void db.applications.delete(app.id!).then(bumpApplicationsRev).then(refresh);
                    }}
                    variant="card"
                    key={app.id}
                    focused={app.id === launchApplicationId}
                    onFocused={onLaunchConsumed}
                    onDragStart={() => setDraggedId(app.id ?? null)}
                    onDragEnd={() => setDraggedId(null)}
                  />
                ))}
                {columnApplications.length === 0 && <div className="columnEmpty">Drop an opportunity here</div>}
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
  onUpdate,
  onDelete,
  variant = "list",
  focused = false,
  onFocused,
  onDragStart,
  onDragEnd
}: {
  app: Application;
  onUpdate: (patch: Partial<Application>) => void;
  onDelete: () => void;
  variant?: "list" | "card";
  focused?: boolean;
  onFocused?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const rowRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!focused) return;
    setExpanded(true);
    window.requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      onFocused?.();
    });
  }, [focused, onFocused]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function update(patch: Partial<Application>) {
    onUpdate(patch);
  }

  async function remove() {
    if (!app.id) return;
    onDelete();
  }

  async function copyJob() {
    await navigator.clipboard.writeText(applicationToClipboardText(app));
    setCopied(true);
  }

  return (
    <article
      ref={rowRef}
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
          <strong>{app.role || (app.outreach ? "Service" : "Role")}</strong>
          <p><Building2 size={12} /> {app.company || (app.outreach ? "Business" : "Company")}</p>
          {app.upwork && <small className="upworkBadge">Upwork · {app.upwork.status}</small>}
          {app.outreach && <small className="outreachBadge">Local · {app.outreach.status}</small>}
          {variant === "list" && <small>{app.outreach?.status ?? app.status} | {dateInputValue(app.dateApplied)} | {app.source}</small>}
          {app.compensation?.text && <small>{app.compensation.text}</small>}
          {(app.location || app.workMode) && <small className="cardMeta"><MapPin size={11} /> {[app.location, app.workMode].filter(Boolean).join(" · ")}</small>}
          {app.outreach?.contactName && <small className="cardMeta"><UserRound size={11} /> {app.outreach.contactName}</small>}
          {variant === "card" && !app.location && !app.workMode && !app.outreach?.contactName && <small className="cardMeta"><BriefcaseBusiness size={11} /> {app.source}</small>}
        </div>
        <div className="appSummaryActions">
          <button className="rowIconButton" title={copied ? "Copied" : "Copy all opportunity data"} aria-label={copied ? "Copied" : "Copy all opportunity data"} onClick={() => void copyJob()}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
          <button className="rowIconButton danger" title="Delete application" aria-label="Delete application" onClick={() => void remove()}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="appDetails">
          <label>
            <span>{app.outreach ? "Business" : "Company"}</span>
            <input value={app.company} onChange={(event) => void update({ company: event.target.value })} />
          </label>
          <label>
            <span>{app.outreach ? "Service" : "Role"}</span>
            <input value={app.role} onChange={(event) => void update({ role: event.target.value })} />
          </label>
          <label>
            <span>Status</span>
            {app.outreach ? (
              <select value={app.outreach.status} onChange={(event) => void update(changeOutreachStatus(app, event.target.value as OutreachStatus))}>
                {OUTREACH_STATUSES.map((status) => <option key={status}>{status}</option>)}
              </select>
            ) : (
              <select value={app.status} onChange={(event) => void update({ status: event.target.value as ApplicationStatus })}>
                {statuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            )}
          </label>
          <label>
            <span>{app.outreach ? "Date added" : "Applied date"}</span>
            <input type="date" value={dateInputValue(app.dateApplied)} onChange={(event) => void update({ dateApplied: dateToIso(event.target.value) })} />
          </label>
          <label>
            <span>Follow-up date</span>
            <input type="date" value={app.nextActionDate?.slice(0, 10) ?? ""} onChange={(event) => void update({ nextActionDate: event.target.value })} />
          </label>
          {app.outreach && (
            <fieldset className="outreachEditor">
              <legend>Local contact</legend>
              <label><span>Contact name</span><input value={app.outreach.contactName} onChange={(event) => void update({ outreach: { ...app.outreach!, contactName: event.target.value } })} /></label>
              <label>
                <span>Contact method</span>
                <select value={app.outreach.contactMethod} onChange={(event) => void update({ outreach: { ...app.outreach!, contactMethod: event.target.value as NonNullable<Application["outreach"]>["contactMethod"] } })}>
                  <option value="">Not set</option>
                  {OUTREACH_CONTACT_METHODS.map((method) => <option key={method}>{method}</option>)}
                </select>
              </label>
              <label><span>Email, phone, or handle</span><input value={app.outreach.contactDetails} onChange={(event) => void update({ outreach: { ...app.outreach!, contactDetails: event.target.value } })} /></label>
              <label><span>First contacted</span><input type="date" value={app.outreach.contactedAt?.slice(0, 10) ?? ""} onChange={(event) => void update({ outreach: { ...app.outreach!, contactedAt: event.target.value || undefined } })} /></label>
              <label><span>Business website</span><input value={app.jobUrl} onChange={(event) => void update({ jobUrl: event.target.value })} /></label>
            </fieldset>
          )}
          {!app.outreach && <label>
            <span>Location</span>
            <input value={app.location ?? ""} onChange={(event) => void update({ location: event.target.value })} />
          </label>}
          {!app.outreach && <label>
            <span>Work mode</span>
            <select value={app.workMode ?? ""} onChange={(event) => void update({ workMode: event.target.value as Application["workMode"] })}>
              <option value="">Unknown</option>
              <option value="Remote">Remote</option>
              <option value="Hybrid">Hybrid</option>
              <option value="On-site">On-site</option>
            </select>
          </label>}
          {app.upwork && (
            <fieldset className="upworkEditor">
              <legend>Upwork proposal</legend>
              <label>
                <span>Proposal status</span>
                <select value={app.upwork.status} onChange={(event) => void update(changeUpworkStatus(app, event.target.value as UpworkProposalStatus))}>
                  {UPWORK_PROPOSAL_STATUSES.map((proposalStatus) => <option key={proposalStatus}>{proposalStatus}</option>)}
                </select>
              </label>
              <label>
                <span>Contract type</span>
                <select value={app.upwork.contractType} onChange={(event) => void update({ upwork: { ...app.upwork!, contractType: event.target.value as "hourly" | "fixed" | "" } })}>
                  <option value="">Unknown</option>
                  <option value="hourly">Hourly</option>
                  <option value="fixed">Fixed-price</option>
                </select>
              </label>
              <label><span>Proposed amount</span><input type="number" min="0" value={app.upwork.proposedAmount ?? ""} onChange={(event) => void update({ upwork: { ...app.upwork!, proposedAmount: numberOrNull(event.target.value) } })} /></label>
              <label><span>Base Connects</span><input type="number" min="0" value={app.upwork.baseConnects ?? ""} onChange={(event) => void update({ upwork: { ...app.upwork!, baseConnects: numberOrNull(event.target.value) } })} /></label>
              <label><span>Boost bid</span><input type="number" min="0" value={app.upwork.boostBid ?? ""} onChange={(event) => void update({ upwork: { ...app.upwork!, boostBid: numberOrNull(event.target.value) } })} /></label>
              <label><span>Boost charged</span><input type="number" min="0" value={app.upwork.boostCharged ?? ""} onChange={(event) => void update({ upwork: { ...app.upwork!, boostCharged: numberOrNull(event.target.value) } })} /></label>
            </fieldset>
          )}
          {!app.outreach && <label>
            <span>Compensation</span>
            <input value={app.compensation?.text ?? ""} onChange={(event) => void update({ compensation: { ...(app.compensation ?? emptyCompensation()), text: event.target.value } })} />
          </label>}
          {!app.outreach && <label>
            <span>Currency</span>
            <select value={app.compensation?.currency ?? ""} onChange={(event) => void update({ compensation: { ...(app.compensation ?? emptyCompensation()), currency: event.target.value as CompensationCurrency } })}>
              <option value="">Unknown</option>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>}
          {!app.outreach && <label>
            <span>Comp min</span>
            <input value={app.compensation?.min ?? ""} onChange={(event) => void update({ compensation: { ...(app.compensation ?? emptyCompensation()), min: numberOrUndefined(event.target.value) } })} />
          </label>}
          {!app.outreach && <label>
            <span>Comp max</span>
            <input value={app.compensation?.max ?? ""} onChange={(event) => void update({ compensation: { ...(app.compensation ?? emptyCompensation()), max: numberOrUndefined(event.target.value) } })} />
          </label>}
          {!app.outreach && <label>
            <span>Comp period</span>
            <select value={app.compensation?.period ?? ""} onChange={(event) => void update({ compensation: { ...(app.compensation ?? emptyCompensation()), period: event.target.value as CompensationPeriod } })}>
              <option value="">Unknown</option>
              <option value="year">Year</option>
              <option value="month">Month</option>
              <option value="hour">Hour</option>
              <option value="one-time">One-time</option>
            </select>
          </label>}
          {!app.outreach && <label>
            <span>Job description</span>
            <textarea rows={5} value={app.jobDescription ?? ""} onChange={(event) => void update({ jobDescription: event.target.value })} />
          </label>}
          <label>
            <span>Source</span>
            <input value={app.source} onChange={(event) => void update({ source: event.target.value })} />
          </label>
          <label>
            <span>Notes</span>
            <textarea rows={5} value={app.notes ?? ""} onChange={(event) => void update({ notes: event.target.value })} />
          </label>
        </div>
      )}
    </article>
  );
}

function dateInputValue(value: string | undefined): string {
  if (!value) return localTodayISO();
  return localDateISO(value);
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

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid non-negative number: ${value}`);
  return parsed;
}

function dateToIso(value: string): string {
  if (!value) return new Date().toISOString();
  return new Date(`${value}T12:00:00`).toISOString();
}

function MemoryPanel({ memories, refresh, demoMode, setMemories }: { memories: AnswerMemory[]; refresh: () => Promise<void>; demoMode: boolean; setMemories: React.Dispatch<React.SetStateAction<AnswerMemory[]>> }) {
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
    const existing = demoMode ? memories.find((memory) => memory.questionHash === hash) : await db.answerMemory.where("questionHash").equals(hash).first();
    const payload: AnswerMemory = {
      questionHash: hash,
      questionText,
      answer,
      lastUsed: new Date().toISOString(),
      editable: true
    };

    if (demoMode) {
      const next = { ...payload, id: existing?.id ?? Math.max(0, ...memories.map((memory) => memory.id ?? 0)) + 1 };
      setMemories((current) => existing?.id
        ? current.map((memory) => memory.id === existing.id ? next : memory)
        : [next, ...current]);
      setStatus(existing ? "Existing demo answer updated." : "Demo answer added.");
    } else if (existing?.id) {
      await db.answerMemory.update(existing.id, payload);
      setStatus("Existing answer updated.");
    } else {
      await db.answerMemory.add(payload);
      setStatus("Answer added.");
    }
    setDraft(emptyDraft);
    if (!demoMode) await refresh();
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
      if (demoMode) {
        setMemories((current) => [{ id: Math.max(0, ...current.map((memory) => memory.id ?? 0)) + 1, questionHash: questionHash(questionText), questionText, answer, lastUsed: new Date().toISOString(), editable: true }, ...current]);
      }
      setDraft({ questionText: "", answer: "" });
      setStatus(`AI answer added: ${answer.slice(0, 70)}${answer.length > 70 ? "..." : ""}`);
      if (!demoMode) await refresh();
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
    const existing = demoMode ? memories.find((item) => item.questionHash === hash) : await db.answerMemory.where("questionHash").equals(hash).first();
    if (existing?.id && existing.id !== memory.id) {
      setStatus("Another answer already uses that question.");
      return;
    }

    const patch = { questionHash: hash, questionText, answer, editable: true };
    if (demoMode) setMemories((current) => current.map((item) => item.id === memory.id ? { ...item, ...patch } : item));
    else await db.answerMemory.update(memory.id, patch);
    setEditingId(null);
    setEditDraft(emptyDraft);
    setStatus("Answer saved.");
    if (!demoMode) await refresh();
  }

  async function deleteAnswer(memory: AnswerMemory) {
    if (!memory.id) return;
    if (demoMode) setMemories((current) => current.filter((item) => item.id !== memory.id));
    else await db.answerMemory.delete(memory.id);
    setStatus("Answer deleted.");
    if (!demoMode) await refresh();
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

function BackupPanel({ exportAll, importAll }: { exportAll: () => Promise<void>; importAll: (backup: FullBackup) => Promise<void> }) {
  const [preview, setPreview] = useState<FullBackup | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function readBackup(file: File) {
    setBusy(true);
    setPreview(null);
    setConfirmed(false);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup is larger than 50 MB.");
      const backup = parseBackupJson(await file.text());
      setPreview(backup);
      setStatus("Backup checked. Review it before restoring.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setStatus("Working...");
    try {
      await action();
      setStatus(success);
      setPreview(null);
      setConfirmed(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  return (
    <section className="backupPanel" aria-labelledby="backupTitle">
      <h2 id="backupTitle">Portable backup</h2>
      <p>Move your profile, saved CV and cover letter, all jobs and freelance records, answers, and settings to another instance.</p>
      <p>The JSON file includes private information and your OpenAI API key. Keep it somewhere secure.</p>
      <div className="toolbar backupActions">
        <button type="button" disabled={busy} onClick={() => void run(exportAll, "Backup download started.")}><Download size={14} /> Export all data</button>
        <label className={`importCv${busy ? " backupDisabled" : ""}`}>
          <Upload size={14} /> Import all data
          <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void readBackup(file);
          }} />
        </label>
      </div>
      {preview && (
        <div className="jsonImportPreview">
          <strong>{`${preview.profile.identity.firstName} ${preview.profile.identity.lastName}`.trim() || "Unnamed profile"}</strong>
          <span>Exported {new Date(preview.exportedAt).toLocaleString()} · {preview.applications.length} jobs/opportunities · {preview.answerMemory.length} saved answers</span>
          <span>{preview.profile.resumeFile ? "CV included" : "No saved CV"} · {preview.profile.coverLetterFile ? "Cover letter included" : "No saved cover letter"} · {preview.settings.apiKey ? "API key included" : "No API key"}</span>
          {preview.settings.demoMode && <p>This backup has demo mode enabled. Exit demo mode after restoring to see your real records.</p>}
          <p>Restoring replaces the profile, jobs, answers, and settings in this instance. Export your current data first if you want to keep it.</p>
          <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} /> Replace this instance with this backup</label>
          <div className="toolbar">
            <button type="button" disabled={busy || !confirmed} onClick={() => void run(() => importAll(preview), "All data restored. Reload open job pages to use the restored settings.")}><Upload size={14} /> Restore backup</button>
            <button type="button" disabled={busy} onClick={() => { setPreview(null); setConfirmed(false); setStatus(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {status && <p role="status" aria-live="polite">{status}</p>}
    </section>
  );
}

function SettingsPanel({ settings, save, exportAll, importAll }: { settings: Settings; save: (settings: Settings) => Promise<void>; exportAll: () => Promise<void>; importAll: (backup: FullBackup) => Promise<void> }) {
  return (
    <section className="panel">
      <button
        className="demoModeButton"
        type="button"
        aria-pressed={settings.demoMode}
        onClick={() => void save({ ...settings, demoMode: !settings.demoMode })}
      >
        <Sparkles size={15} />
        {settings.demoMode ? "Exit demo mode" : "Start demo mode"}
      </button>
      <label className="field">
        <span>Theme</span>
        <select value={settings.theme} onChange={(event) => void save({ ...settings, theme: event.target.value as ThemeMode })}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="field">
        <span>Default tracking entry</span>
        <select
          value={settings.trackingEntryMode}
          onChange={(event) => void save({ ...settings, trackingEntryMode: event.target.value as TrackingEntryMode })}
        >
          <option value="manual">Manual form</option>
          <option value="ai">Paste text with AI</option>
        </select>
      </label>
      <Field label="OpenAI API key" type="password" value={settings.apiKey} onChange={(value) => void save({ ...settings, apiKey: value })} />
      <Field label="Model" value={settings.model} onChange={(value) => void save({ ...settings, model: value })} />
      <label>
        <input type="checkbox" checked={settings.matchScoring} onChange={(event) => void save({ ...settings, matchScoring: event.target.checked })} />
        {" "}Enable skill match scoring — the Match tab and job-card badges (off by default; applies after page reload)
      </label>
      <label>
        <input type="checkbox" checked={settings.freelanceOptions} onChange={(event) => void save({ ...settings, freelanceOptions: event.target.checked })} />
        {" "}Enable freelance options — Upwork proposals and local outreach (off by default)
      </label>
      <div className="siteGrid">
        <label>
          <input type="checkbox" checked={settings.blockLinkedInExtensionProbes} onChange={(event) => void save({ ...settings, blockLinkedInExtensionProbes: event.target.checked })} />
          {" "}Block LinkedIn extension probes (reload LinkedIn after changing)
        </label>
        {Object.entries(settings.enabledSites).map(([site, enabled]) => (
          <label key={site}><input type="checkbox" checked={enabled} onChange={(event) => void save({ ...settings, enabledSites: { ...settings.enabledSites, [site]: event.target.checked } })} /> {site}</label>
        ))}
      </div>
      <BackupPanel exportAll={exportAll} importAll={importAll} />
    </section>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="profileSection">
      <button type="button" className="sectionToggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <div className="profileSectionHeading">
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
      </button>
      {open && children}
    </div>
  );
}

type SkillRow = { name: string; years: string; note: string; services: string };

function skillsToRows(skills: Profile["skills"]): SkillRow[] {
  return Object.entries(skills).map(([name, fact]) => ({
    name,
    years: String(fact.years),
    note: fact.note,
    services: fact.services?.join(", ") ?? ""
  }));
}

function rowsToSkills(rows: SkillRow[]): Profile["skills"] {
  const skills: Profile["skills"] = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    skills[name] = {
      years: Number(row.years) || 0,
      note: row.note.trim(),
      services: commaList(row.services)
    };
  }
  return skills;
}

function SkillsEditor({ skills, onCommit }: { skills: Profile["skills"]; onCommit: (skills: Profile["skills"]) => void }) {
  const [rows, setRows] = useState<SkillRow[]>(() => skillsToRows(skills));
  useEffect(() => setRows(skillsToRows(skills)), [skills]);

  const edit = (index: number, patch: Partial<SkillRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const commit = (nextRows: SkillRow[]) => {
    const parsed = rowsToSkills(nextRows);
    if (JSON.stringify(parsed) !== JSON.stringify(skills)) onCommit(parsed);
  };
  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    setRows(next);
    commit(next);
  };

  return (
    <div className="factList" onBlur={() => commit(rows)}>
      <div className="skillRow skillRowHead">
        <span>Skill</span>
        <span>Years</span>
        <span>Note</span>
        <span>Services</span>
        <span />
      </div>
      {rows.map((row, index) => (
        <div className="skillRow" key={index}>
          <input placeholder="Skill name" value={row.name} onChange={(event) => edit(index, { name: event.target.value })} />
          <input type="number" min="0" value={row.years} onChange={(event) => edit(index, { years: event.target.value })} />
          <input placeholder="Note" value={row.note} onChange={(event) => edit(index, { note: event.target.value })} />
          <input placeholder="Comma separated" value={row.services} onChange={(event) => edit(index, { services: event.target.value })} />
          <button type="button" className="factRemove" title="Remove skill" onClick={() => remove(index)}>
            <X size={13} />
          </button>
        </div>
      ))}
      <button type="button" className="factAdd" onClick={() => setRows([...rows, { name: "", years: "0", note: "", services: "" }])}>
        <Plus size={14} />
        Add skill
      </button>
    </div>
  );
}

type ExperienceRow = { title: string; company: string; start: string; end: string; highlights: string; stack: string };

function experienceToRows(experience: Experience[]): ExperienceRow[] {
  return experience.map((item) => ({
    title: item.title,
    company: item.company,
    start: item.start,
    end: item.end,
    highlights: item.highlights.join("\n"),
    stack: item.stack.join(", ")
  }));
}

function rowsToExperience(rows: ExperienceRow[]): Experience[] {
  return rows
    .filter((row) => row.title.trim() || row.company.trim())
    .map((row) => ({
      title: row.title.trim(),
      company: row.company.trim(),
      start: row.start.trim(),
      end: row.end.trim(),
      highlights: lineList(row.highlights),
      stack: commaList(row.stack)
    }));
}

function ExperienceEditor({ experience, onCommit }: { experience: Experience[]; onCommit: (experience: Experience[]) => void }) {
  const [rows, setRows] = useState<ExperienceRow[]>(() => experienceToRows(experience));
  useEffect(() => setRows(experienceToRows(experience)), [experience]);

  const edit = (index: number, patch: Partial<ExperienceRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const commit = (nextRows: ExperienceRow[]) => {
    const parsed = rowsToExperience(nextRows);
    if (JSON.stringify(parsed) !== JSON.stringify(experience)) onCommit(parsed);
  };
  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    setRows(next);
    commit(next);
  };

  return (
    <div className="factList" onBlur={() => commit(rows)}>
      {rows.map((row, index) => (
        <div className="factCard" key={index}>
          <div className="factCardHeader">
            <strong>{row.title.trim() || row.company.trim() || "New role"}</strong>
            <button type="button" className="factRemove" title="Remove role" onClick={() => remove(index)}>
              <X size={13} />
            </button>
          </div>
          <div className="grid two">
            <Field label="Title" value={row.title} onChange={(value) => edit(index, { title: value })} />
            <Field label="Company" value={row.company} onChange={(value) => edit(index, { company: value })} />
            <Field label="Start (e.g. Jan 2023)" value={row.start} onChange={(value) => edit(index, { start: value })} />
            <Field label="End (e.g. Sep 2023 or Present)" value={row.end} onChange={(value) => edit(index, { end: value })} />
          </div>
          <label className="field">
            <span>Responsibilities / highlights, one per line</span>
            <textarea rows={3} value={row.highlights} onChange={(event) => edit(index, { highlights: event.target.value })} />
          </label>
          <Field label="Stack, comma separated" value={row.stack} onChange={(value) => edit(index, { stack: value })} />
        </div>
      ))}
      <button
        type="button"
        className="factAdd"
        onClick={() => setRows([...rows, { title: "", company: "", start: "", end: "", highlights: "", stack: "" }])}
      >
        <Plus size={14} />
        Add role
      </button>
    </div>
  );
}

type ProjectRow = {
  name: string;
  role: string;
  start: string;
  end: string;
  description: string;
  highlights: string;
  stack: string;
  url: string;
  repository: string;
};

function projectsToRows(projects: PersonalProject[]): ProjectRow[] {
  return projects.map((project) => ({
    name: project.name,
    role: project.role,
    start: project.start,
    end: project.end,
    description: project.description,
    highlights: project.highlights.join("\n"),
    stack: project.stack.join(", "),
    url: project.url,
    repository: project.repository
  }));
}

function rowsToProjects(rows: ProjectRow[]): PersonalProject[] {
  return rows
    .filter((row) => row.name.trim())
    .map((row) => ({
      name: row.name.trim(),
      role: row.role.trim(),
      start: row.start.trim(),
      end: row.end.trim(),
      description: row.description.trim(),
      highlights: lineList(row.highlights),
      stack: commaList(row.stack),
      url: row.url.trim(),
      repository: row.repository.trim()
    }));
}

function ProjectsEditor({ projects, onCommit }: { projects: PersonalProject[]; onCommit: (projects: PersonalProject[]) => void }) {
  const [rows, setRows] = useState<ProjectRow[]>(() => projectsToRows(projects));
  useEffect(() => setRows(projectsToRows(projects)), [projects]);

  const edit = (index: number, patch: Partial<ProjectRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const commit = (nextRows: ProjectRow[]) => {
    const parsed = rowsToProjects(nextRows);
    if (JSON.stringify(parsed) !== JSON.stringify(projects)) onCommit(parsed);
  };
  const remove = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    setRows(next);
    commit(next);
  };

  return (
    <div className="factList" onBlur={() => commit(rows)}>
      {rows.map((row, index) => (
        <div className="factCard" key={index}>
          <div className="factCardHeader">
            <strong>{row.name.trim() || "New project"}</strong>
            <button type="button" className="factRemove" title="Remove project" onClick={() => remove(index)}>
              <X size={13} />
            </button>
          </div>
          <div className="grid two">
            <Field label="Name" value={row.name} onChange={(value) => edit(index, { name: value })} />
            <Field label="Role" value={row.role} onChange={(value) => edit(index, { role: value })} />
            <Field label="Start" value={row.start} onChange={(value) => edit(index, { start: value })} />
            <Field label="End" value={row.end} onChange={(value) => edit(index, { end: value })} />
          </div>
          <label className="field">
            <span>Description</span>
            <textarea rows={2} value={row.description} onChange={(event) => edit(index, { description: event.target.value })} />
          </label>
          <label className="field">
            <span>Highlights, one per line</span>
            <textarea rows={3} value={row.highlights} onChange={(event) => edit(index, { highlights: event.target.value })} />
          </label>
          <div className="grid two">
            <Field label="Stack, comma separated" value={row.stack} onChange={(value) => edit(index, { stack: value })} />
            <Field label="URL" value={row.url} onChange={(value) => edit(index, { url: value })} />
            <Field label="Repository" value={row.repository} onChange={(value) => edit(index, { repository: value })} />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="factAdd"
        onClick={() =>
          setRows([...rows, { name: "", role: "", start: "", end: "", description: "", highlights: "", stack: "", url: "", repository: "" }])
        }
      >
        <Plus size={14} />
        Add project
      </button>
    </div>
  );
}

function commaList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function lineList(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
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
