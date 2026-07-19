import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BriefcaseBusiness, Building2, CalendarClock, ChevronDown, ChevronRight, Download, FileText, KeyRound, ListFilter, MapPin, Plus, Save, Search, Sparkles, Trash2, Upload, UserRound, Wand2, X } from "lucide-react";
import { draftApplicationFromJobPosting, draftSingleAnswer, enrichProfileFromText, importProfileFromCv } from "../../lib/ai";
import { normalizeCompensationCurrency } from "../../lib/compensation";
import { db } from "../../lib/db";
import { createDemoApplications, createDemoMemories } from "../../lib/demo";
import { questionHash } from "../../lib/mapping";
import { formatExperience, formatProjects, formatSkills, parseExperience, parseProjects, parseSkills } from "../../lib/profileText";
import { EMPTY_PROFILE, type AnswerMemory, type Application, type ApplicationStatus, type CompensationCurrency, type CompensationPeriod, type PendingApplication, type Profile, type Settings, type ThemeMode, type UpworkProposalStatus } from "../../lib/schema";
import { clearDashboardLaunch, getDashboardLaunch, getPendingApplications, getProfile, getSettings, removePendingApplication, saveProfile, saveSettings } from "../../lib/storage";
import { applyTheme } from "../../lib/theme";
import { changeUpworkStatus, UPWORK_PROPOSAL_STATUSES, upworkRate, upworkSummary } from "../../lib/upwork";
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

    if (settings?.demoMode) {
      setProfileSaveStatus("Demo changes are temporary");
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
  }, [profile, settings?.demoMode]);

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
    if (nextSettings.demoMode) {
      setApplications(createDemoApplications());
      setPendingApplications([]);
      setMemories(createDemoMemories());
      setProfileSaveStatus("Demo changes are temporary");
    } else {
      setApplications(await db.applications.orderBy("dateApplied").reverse().toArray());
      setPendingApplications(await getPendingApplications());
      setMemories(await db.answerMemory.orderBy("lastUsed").reverse().toArray());
    }
  }

  async function persistSettings(next: Settings) {
    const demoModeChanged = next.demoMode !== settings?.demoMode;
    setSettings(next);
    applyTheme(next.theme);
    await saveSettings(next);
    if (demoModeChanged) await refresh();
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

  const dueCount = applications.filter((app) => app.nextActionDate && new Date(app.nextActionDate) <= new Date()).length;
  const weekCount = applications.filter((app) => Date.now() - new Date(app.dateApplied).getTime() < 7 * 24 * 60 * 60 * 1000).length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local-first job ops</p>
          <h1>Autofill desk</h1>
        </div>
        {settings?.demoMode && <span className="demoBadge"><Sparkles size={13} /> Demo mode</span>}
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
          demoMode={Boolean(settings?.demoMode)}
          setApplications={setApplications}
          launchPendingId={launchPendingId}
          onLaunchConsumed={() => setLaunchPendingId(undefined)}
        />
      )}
      {tab === "memory" && <MemoryPanel memories={memories} refresh={refresh} demoMode={Boolean(settings?.demoMode)} setMemories={setMemories} />}
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
  const [smartAddText, setSmartAddText] = useState("");
  const [smartAddStatus, setSmartAddStatus] = useState("");
  const [smartAdding, setSmartAdding] = useState(false);
  const [skillsText, setSkillsText] = useState(() => formatSkills(profile.skills));
  const [experienceText, setExperienceText] = useState(() => formatExperience(profile.experience));
  const [projectsText, setProjectsText] = useState(() => formatProjects(profile.personalProjects));

  useEffect(() => setSkillsText(formatSkills(profile.skills)), [profile.skills]);
  useEffect(() => setExperienceText(formatExperience(profile.experience)), [profile.experience]);
  useEffect(() => setProjectsText(formatProjects(profile.personalProjects)), [profile.personalProjects]);

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

  function updateSkills(value: string) {
    setProfile({ ...profile, skills: parseSkills(value) });
  }

  function updateExperience(value: string) {
    setProfile({ ...profile, experience: parseExperience(value) });
  }

  function updateProjects(value: string) {
    setProfile({ ...profile, personalProjects: parseProjects(value) });
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

      <div className="profileSection">
        <div className="profileSectionHeading">
          <h3>Additional answer knowledge</h3>
          <p>Paste completed Q&amp;As or nuanced facts that do not fit another profile section.</p>
        </div>
        <label className="field">
          <span>Facts AI may use in application answers</span>
          <textarea
            rows={10}
            value={profile.additionalKnowledge}
            onChange={(event) => update("additionalKnowledge", event.target.value)}
            placeholder="Example: I advise non-technical fintech clients during implementations..."
          />
        </label>
      </div>

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
      {importStatus && <p className="saveStamp">{importStatus}</p>}

      <div className="profileSection">
        <div className="profileSectionHeading">
          <h3>Identity & contact</h3>
          <p>Reusable facts copied directly into applications.</p>
        </div>
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
      </div>

      <div className="profileSection">
        <div className="profileSectionHeading">
          <h3>Authorization & application defaults</h3>
          <p>Explicit reusable answers. Legal declarations are always left for review.</p>
        </div>
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
      </div>

      <div className="profileSection">
        <div className="profileSectionHeading">
          <h3>Optional demographic answers</h3>
          <p>Leave blank to keep these questions in the autofill review.</p>
        </div>
        <div className="grid two">
          <Field label="Gender" value={profile.demographics.gender} onChange={(value) => update("demographics.gender", value)} />
          <Field label="Ethnic origin" value={profile.demographics.race} onChange={(value) => update("demographics.race", value)} />
          <Field label="Veteran status" value={profile.demographics.veteran} onChange={(value) => update("demographics.veteran", value)} />
          <Field label="Disability disclosure" value={profile.demographics.disability} onChange={(value) => update("demographics.disability", value)} />
        </div>
      </div>

      <div className="profileSection">
        <div className="profileSectionHeading">
          <h3>Experience facts</h3>
          <p>Used for employer, title, skills, and drafted screening answers.</p>
        </div>
      <label className="field">
        <span>Skills, one per line: name|years|note|services</span>
        <textarea rows={6} value={skillsText} onChange={(event) => setSkillsText(event.target.value)} onBlur={() => updateSkills(skillsText)} />
      </label>
      <label className="field">
        <span>Experience, one block per company: title|company|start|end, then responsibilities, then stack</span>
        <textarea rows={10} value={experienceText} onChange={(event) => setExperienceText(event.target.value)} onBlur={() => updateExperience(experienceText)} />
      </label>
      <label className="field">
        <span>Personal projects: name|role|start|end, then description, highlights, stack, and url|repository</span>
        <textarea rows={10} value={projectsText} onChange={(event) => setProjectsText(event.target.value)} onBlur={() => updateProjects(projectsText)} />
      </label>
      </div>
    </section>
  );
}

function TrackerPanel({
  applications,
  pendingApplications,
  refresh,
  demoMode,
  setApplications,
  launchPendingId,
  onLaunchConsumed
}: {
  applications: Application[];
  pendingApplications: PendingApplication[];
  refresh: () => Promise<void>;
  demoMode: boolean;
  setApplications: React.Dispatch<React.SetStateAction<Application[]>>;
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
  const upworkStats = upworkSummary(applications);

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
    if (demoMode) {
      setApplications((current) => current.map((app) => app.id === id ? { ...app, status } : app));
    } else {
      await db.applications.update(id, { status });
      await refresh();
    }
    setDraggedId(null);
  }

  async function addManual() {
    if (!manualDraft.company.trim() || !manualDraft.role.trim()) {
      setParseStatus("Company and role are required.");
      return;
    }

    const application: Application = {
      id: demoMode ? Math.max(0, ...applications.map((app) => app.id ?? 0)) + 1 : undefined,
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
      notes: "",
      upwork: manualDraft.source.trim().toLowerCase() === "upwork" ? {
        status: "Submitted",
        contractType: manualDraft.compensationPeriod === "hour" ? "hourly" : manualDraft.compensationPeriod === "one-time" ? "fixed" : "",
        proposedAmount: numberOrUndefined(manualDraft.compensationMin) ?? null,
        currency: manualDraft.compensationCurrency,
        baseConnects: null,
        boostBid: null,
        boostCharged: null
      } : undefined
    };
    if (demoMode) setApplications((current) => [application, ...current]);
    else await db.applications.add(application);
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
    if (!demoMode) await refresh();
  }

  function exportCsv() {
    const rows = [["company", "role", "status", "source", "dateApplied", "nextActionDate", "location", "workMode", "compensation", "compensationCurrency", "compensationMin", "compensationMax", "compensationPeriod", "jobUrl", "jobDescription", "notes", "upworkStatus", "upworkContractType", "upworkProposedAmount", "upworkCurrency", "upworkBaseConnects", "upworkBoostBid", "upworkBoostCharged", "upworkRespondedAt", "upworkInterviewedAt", "upworkOfferedAt", "upworkHiredAt"]];
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
      app.notes,
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
      const application: Application = {
        id: demoMode ? Math.max(0, ...applications.map((app) => app.id ?? 0)) + 1 : undefined,
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
        upwork: draft.upwork,
        answersUsed: [],
        notes: ""
      };
      if (demoMode) setApplications((current) => [application, ...current]);
      else await db.applications.add(application);
      if (activePendingId) {
        await removePendingApplication(activePendingId);
        setActivePendingId(null);
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
      <div className="toolbar trackerToolbar">
        <label className="searchBox">
          <Search size={15} />
          <input aria-label="Search applications" placeholder="Search roles or companies" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button onClick={() => setManualOpen(!manualOpen)}>Add</button>
        <button onClick={() => setPasteOpen(!pasteOpen)}>Paste</button>
        <button className="iconButton" title="Export CSV" onClick={exportCsv}><Download size={16} /></button>
      </div>
      {upworkStats.count > 0 && (
        <section className="upworkSummary" aria-label="Upwork proposal performance">
          <div><span>Upwork proposals</span><strong>{upworkStats.count}</strong></div>
          <div><span>Connects spent</span><strong>{upworkStats.actualConnects}</strong></div>
          <div><span>Responses</span><strong>{upworkStats.responses} · {upworkRate(upworkStats.responses, upworkStats.count)}</strong></div>
          <div><span>Interviews</span><strong>{upworkStats.interviews} · {upworkRate(upworkStats.interviews, upworkStats.count)}</strong></div>
          <div><span>Offers</span><strong>{upworkStats.offers}</strong></div>
          <div><span>Hires</span><strong>{upworkStats.hires}</strong></div>
        </section>
      )}
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
            <span>Paste job posting or Upwork proposal</span>
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
                    onUpdate={(patch) => {
                      if (demoMode) setApplications((current) => current.map((item) => item.id === app.id ? { ...item, ...patch } : item));
                      else void db.applications.update(app.id!, patch).then(refresh);
                    }}
                    onDelete={() => {
                      if (demoMode) setApplications((current) => current.filter((item) => item.id !== app.id));
                      else void db.applications.delete(app.id!).then(refresh);
                    }}
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
  onUpdate,
  onDelete,
  variant = "list",
  onDragStart,
  onDragEnd
}: {
  app: Application;
  onUpdate: (patch: Partial<Application>) => void;
  onDelete: () => void;
  variant?: "list" | "card";
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  async function update(patch: Partial<Application>) {
    onUpdate(patch);
  }

  async function remove() {
    if (!app.id) return;
    onDelete();
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
          {app.upwork && <small className="upworkBadge">Upwork · {app.upwork.status}</small>}
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
    application.upwork ? `Upwork proposal status: ${application.upwork.status}` : "",
    application.upwork?.contractType ? `Upwork contract type: ${application.upwork.contractType}` : "",
    application.upwork?.proposedAmount != null ? `Proposed amount: ${application.upwork.proposedAmount} ${application.upwork.currency}` : "",
    application.upwork?.baseConnects != null ? `Base Connects: ${application.upwork.baseConnects}` : "",
    application.upwork?.boostBid != null ? `Boost bid: ${application.upwork.boostBid} Connects` : "",
    application.upwork?.boostCharged != null ? `Boost charged: ${application.upwork.boostCharged} Connects` : "",
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

function todayInputDate(): string {
  return new Date().toISOString().slice(0, 10);
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

function SettingsPanel({ settings, save }: { settings: Settings; save: (settings: Settings) => Promise<void> }) {
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
