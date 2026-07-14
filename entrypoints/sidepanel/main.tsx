import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Building2, CalendarClock, ChevronDown, ChevronRight, ClipboardCopy, ClipboardPaste, ExternalLink, LayoutDashboard, LoaderCircle, MessageSquareText, Plus, Trash2, Wand2 } from "lucide-react";
import { draftApplicationFromJobPosting, draftSingleAnswer } from "../../lib/ai";
import { normalizeCompensationCurrency } from "../../lib/compensation";
import { sendAutofillMessage } from "../../lib/autofill";
import { db } from "../../lib/db";
import type { Application, ApplicationStatus, CompensationCurrency, CompensationPeriod } from "../../lib/schema";
import { clearSidebarLaunch, getPendingApplications, getProfile, getSettings, getSidebarLaunch, removePendingApplication } from "../../lib/storage";
import { applyTheme } from "../../lib/theme";
import "./styles.css";

type SidePanelStats = {
  dayCount: number;
  yesterdayCount: number;
  weekCount: number;
};

const statuses: ApplicationStatus[] = ["Saved", "Applied", "Screen", "Interview", "Offer", "Rejected", "Ghosted"];
type TrackerStatusFilter = ApplicationStatus | "All";
const emptyManualDraft = {
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
};

function SidePanel() {
  const [stats, setStats] = useState<SidePanelStats>({ dayCount: 0, yesterdayCount: 0, weekCount: 0 });
  const [applications, setApplications] = useState<Application[]>([]);
  const [trackOpen, setTrackOpen] = useState(true);
  const [trackerQuery, setTrackerQuery] = useState("");
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatusFilter>("All");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(emptyManualDraft);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [postingText, setPostingText] = useState("");
  const [activePendingId, setActivePendingId] = useState<string | null>(null);
  const [pasteCreating, setPasteCreating] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [answerQuestion, setAnswerQuestion] = useState("");
  const [draftedAnswer, setDraftedAnswer] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    void loadInitialState();

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      if (changes.settings) void applySavedTheme();
      if (changes.pendingApplications) void loadTrackingData();
      if (changes.sidebarLaunch) void consumeTrackerLaunch();
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  async function loadInitialState() {
    await Promise.all([loadTrackingData(), applySavedTheme()]);
    await consumeTrackerLaunch();
  }

  async function consumeTrackerLaunch() {
    const launch = await getSidebarLaunch();
    if (!launch?.pendingId) return;
    const pendingApplications = await getPendingApplications();
    const pending = pendingApplications.find((item) => item.id === launch.pendingId);
    if (!pending) throw new Error(`Pending application ${launch.pendingId} was not found.`);
    setTrackOpen(true);
    setManualOpen(false);
    setPasteOpen(true);
    setActivePendingId(pending.id);
    setPostingText(applicationToPasteText(pending.application));
    setStatus("Review this job before adding it to your tracker.");
    await clearSidebarLaunch();
  }

  async function applySavedTheme() {
    const settings = await getSettings();
    applyTheme(settings.theme);
  }

  async function loadTrackingData() {
    const applications = await db.applications.orderBy("dateApplied").reverse().toArray();
    const now = Date.now();
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    setApplications(applications);
    setStats({
      dayCount: applications.filter((app) => isSameLocalDay(new Date(app.dateApplied), today)).length,
      yesterdayCount: applications.filter((app) => isSameLocalDay(new Date(app.dateApplied), yesterday)).length,
      weekCount: applications.filter((app) => now - new Date(app.dateApplied).getTime() < 7 * 24 * 60 * 60 * 1000).length
    });
  }

  async function autofillCurrentPage() {
    setStatus("Autofilling...");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active page tab found.");
      const response = await sendAutofillMessage(tab.id);
      if (!response.ok) throw new Error(response.error ?? "Autofill failed.");
      setStatus(response.resumeOpened ? `Filled ${response.filled} fields. Resume picker opened.` : `Filled ${response.filled} fields.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function openDashboard() {
    await chrome.runtime.openOptionsPage();
    window.close();
  }

  function toggleManualMode() {
    const nextManualOpen = !manualOpen;
    setManualOpen(nextManualOpen);
    if (nextManualOpen) setPasteOpen(false);
  }

  function togglePasteMode() {
    const nextPasteOpen = !pasteOpen;
    setPasteOpen(nextPasteOpen);
    if (nextPasteOpen) setManualOpen(false);
  }

  async function addManualApplication() {
    if (!manualDraft.company.trim() || !manualDraft.role.trim()) {
      setStatus("Company and role are required.");
      return;
    }

    setStatus("Creating...");
    try {
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
      setManualDraft(emptyManualDraft);
      setManualOpen(false);
      setStatus("Manual tracker row created.");
      await loadTrackingData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function addPastedApplication() {
    if (pasteCreating) return;
    setPasteCreating(true);
    setStatus("Reading posting...");
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
      setStatus(`Tracked ${draft.company || "Company"} - ${draft.role || "Role"}.`);
      await loadTrackingData();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setPasteCreating(false);
    }
  }

  async function updateApplication(app: Application, patch: Partial<Application>) {
    try {
      if (!app.id) throw new Error("Tracked job is missing an id.");
      await db.applications.update(app.id, patch);
      await loadTrackingData();
      setStatus("Tracked job updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteApplication(app: Application) {
    try {
      if (!app.id) throw new Error("Tracked job is missing an id.");
      if (!window.confirm(`Delete ${app.company || "this company"} - ${app.role || "this role"}?`)) return;
      await db.applications.delete(app.id);
      await loadTrackingData();
      setStatus("Tracked job deleted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function generateAnswer() {
    setStatus("Drafting answer...");
    try {
      const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
      const answer = await draftSingleAnswer(answerQuestion, profile, settings);
      setDraftedAnswer(answer);
      setStatus("Answer drafted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function copyAnswer() {
    if (!draftedAnswer) return;
    await navigator.clipboard.writeText(draftedAnswer);
    setStatus("Answer copied.");
  }

  const visibleApplications = applications.filter((app) => {
    const query = trackerQuery.trim().toLowerCase();
    const matchesQuery = !query || `${app.company} ${app.role} ${app.source} ${app.status} ${app.notes}`.toLowerCase().includes(query);
    const matchesStatus = trackerStatus === "All" || app.status === trackerStatus;
    return matchesQuery && matchesStatus;
  });

  return (
    <main className="sidePanelShell">
      <header className="sidePanelHeader">
        <div>
          <p>Job Autofill</p>
          <h1>Quick desk</h1>
        </div>
        <button className="dashboardIcon" title="Open dashboard" onClick={() => void openDashboard()}>
          <LayoutDashboard size={17} />
          <span>Dashboard</span>
        </button>
      </header>

      <section className="statGrid" aria-label="Tracking summary">
        <Stat label="Today" value={stats.dayCount} />
        <Stat label="Yesterday" value={stats.yesterdayCount} />
        <Stat label="Week" value={stats.weekCount} />
      </section>

      <div className="quickActions">
        <button className="autofillButton" title="Autofill page" onClick={() => void autofillCurrentPage()}>
          <Wand2 size={15} />
          <span>Autofill</span>
        </button>
        <button className="trackButton" title="Toggle tracker" aria-pressed={trackOpen} onClick={() => setTrackOpen(!trackOpen)}>
          <CalendarClock size={15} />
          <span>Tracker</span>
        </button>
        <button className="answerButton" title="Draft an answer" aria-pressed={answerOpen} onClick={() => setAnswerOpen(!answerOpen)}>
          <MessageSquareText size={15} />
          <span>Answer</span>
        </button>
      </div>

      {trackOpen && (
        <section className="trackPanel">
          <div className="trackActions">
            <button onClick={toggleManualMode}>
              <Plus size={15} />
              New job
            </button>
            <button onClick={togglePasteMode}>
              <ClipboardPaste size={15} />
              Paste AI
            </button>
          </div>
          {manualOpen && (
            <div className="manualPanel">
              <input
                placeholder="Company"
                value={manualDraft.company}
                onChange={(event) => setManualDraft({ ...manualDraft, company: event.target.value })}
              />
              <input
                placeholder="Role"
                value={manualDraft.role}
                onChange={(event) => setManualDraft({ ...manualDraft, role: event.target.value })}
              />
              <input
                placeholder="Job URL"
                value={manualDraft.jobUrl}
                onChange={(event) => setManualDraft({ ...manualDraft, jobUrl: event.target.value })}
              />
              <input
                placeholder="Compensation"
                value={manualDraft.compensationText}
                onChange={(event) => setManualDraft({ ...manualDraft, compensationText: event.target.value })}
              />
              <div className="manualGrid">
                <input
                  placeholder="Source"
                  value={manualDraft.source}
                  onChange={(event) => setManualDraft({ ...manualDraft, source: event.target.value })}
                />
                <select
                  value={manualDraft.status}
                  onChange={(event) => setManualDraft({ ...manualDraft, status: event.target.value as ApplicationStatus })}
                >
                  {statuses.map((status) => <option key={status}>{status}</option>)}
                </select>
              </div>
              <div className="manualGrid three">
                <select
                  value={manualDraft.compensationCurrency}
                  onChange={(event) => setManualDraft({ ...manualDraft, compensationCurrency: event.target.value as CompensationCurrency })}
                >
                  <option value="">Currency</option>
                  <option value="MXN">MXN</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
                <input
                  placeholder="Min"
                  inputMode="decimal"
                  value={manualDraft.compensationMin}
                  onChange={(event) => setManualDraft({ ...manualDraft, compensationMin: event.target.value })}
                />
                <input
                  placeholder="Max"
                  inputMode="decimal"
                  value={manualDraft.compensationMax}
                  onChange={(event) => setManualDraft({ ...manualDraft, compensationMax: event.target.value })}
                />
              </div>
              <select
                value={manualDraft.compensationPeriod}
                onChange={(event) => setManualDraft({ ...manualDraft, compensationPeriod: event.target.value as CompensationPeriod })}
              >
                <option value="">Period</option>
                <option value="year">Year</option>
                <option value="month">Month</option>
                <option value="hour">Hour</option>
                <option value="one-time">One-time</option>
              </select>
              <button onClick={() => void addManualApplication()}>Create tracker row</button>
            </div>
          )}
          {pasteOpen && (
            <div className="pastePanel">
              <textarea
                rows={5}
                placeholder="Paste the job posting"
                value={postingText}
                onChange={(event) => setPostingText(event.target.value)}
              />
              <button disabled={pasteCreating} onClick={() => void addPastedApplication()}>
                {pasteCreating && <LoaderCircle className="buttonSpinner" size={15} />}
                {pasteCreating ? "Creating..." : "Create tracker row"}
              </button>
            </div>
          )}
          <div className="trackedJobs">
            <div className="trackedJobsHeader">
              <span>{visibleApplications.length} tracked</span>
              <button type="button" onClick={() => void openDashboard()}>All</button>
            </div>
            <div className="trackerFilters">
              <input
                aria-label="Search tracked jobs"
                placeholder="Search jobs"
                value={trackerQuery}
                onChange={(event) => setTrackerQuery(event.target.value)}
              />
              <select
                aria-label="Filter tracked jobs by status"
                value={trackerStatus}
                onChange={(event) => setTrackerStatus(event.target.value as TrackerStatusFilter)}
              >
                <option value="All">All</option>
                {statuses.map((status) => <option key={status}>{status}</option>)}
              </select>
            </div>
            {applications.length === 0 && (
              <p className="emptyJobs">New and tracked jobs will show here.</p>
            )}
            {applications.length > 0 && visibleApplications.length === 0 && (
              <p className="emptyJobs">No tracked jobs match this view.</p>
            )}
            {visibleApplications.map((app) => (
              <TrackedJob
                app={app}
                key={app.id ?? `${app.company}-${app.role}-${app.dateApplied}`}
                onUpdate={(patch) => void updateApplication(app, patch)}
                onDelete={() => void deleteApplication(app)}
              />
            ))}
          </div>
        </section>
      )}

      {answerOpen && (
        <section className="answerPanel">
          <textarea
            rows={5}
            placeholder="Paste the application question"
            value={answerQuestion}
            onChange={(event) => setAnswerQuestion(event.target.value)}
          />
          <button onClick={() => void generateAnswer()}>
            <Wand2 size={15} />
            Draft answer
          </button>
          {draftedAnswer && (
            <>
              <textarea
                rows={6}
                value={draftedAnswer}
                onChange={(event) => setDraftedAnswer(event.target.value)}
              />
              <button className="copyButton" onClick={() => void copyAnswer()}>
                <ClipboardCopy size={15} />
                Copy answer
              </button>
            </>
          )}
        </section>
      )}

      {status && <p className="status">{status}</p>}
    </main>
  );
}

function compensationFromDraft(draft: typeof emptyManualDraft) {
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

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TrackedJob({
  app,
  onUpdate,
  onDelete
}: {
  app: Application;
  onUpdate: (patch: Partial<Application>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  function updateAnswer(index: number, field: "question" | "answer", value: string) {
    onUpdate({
      answersUsed: app.answersUsed.map((answer, answerIndex) => (
        answerIndex === index ? { ...answer, [field]: value } : answer
      ))
    });
  }

  function updateCompensation(patch: Partial<NonNullable<Application["compensation"]>>) {
    onUpdate({
      compensation: {
        text: app.compensation?.text ?? "",
        currency: app.compensation?.currency ?? "",
        period: app.compensation?.period ?? "",
        ...app.compensation,
        ...patch
      }
    });
  }

  return (
    <article className={expanded ? "trackedJob expanded" : "trackedJob"}>
      <div className="trackedJobTop">
        <button className="trackedJobToggle" type="button" title={expanded ? "Collapse job" : "Expand job"} onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div>
          <div className="trackedJobTitle">
            <strong>{app.role || "Role"}</strong>
            <select
              className="trackedJobStatus"
              aria-label={`Status for ${app.role || "tracked job"}`}
              value={app.status}
              onChange={(event) => onUpdate({ status: event.target.value as ApplicationStatus })}
            >
              {statuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </div>
          <span><Building2 size={12} /> {app.company || "Company"}</span>
        </div>
        <div className="trackedJobActions">
          {app.jobUrl && (
            <a className="jobLink" href={app.jobUrl} target="_blank" rel="noreferrer" title="Open job">
              <ExternalLink size={14} />
            </a>
          )}
          <button className="jobLink danger" type="button" title="Delete job" onClick={onDelete}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {app.nextActionDate && (
        <div className="trackedJobMeta">
          <span>Due {app.nextActionDate.slice(0, 10)}</span>
        </div>
      )}
      {expanded && (
        <>
          <div className="trackedJobControls">
            <input
              aria-label="Follow-up date"
              type="date"
              value={app.nextActionDate?.slice(0, 10) ?? ""}
              onChange={(event) => onUpdate({ nextActionDate: event.target.value })}
            />
          </div>
          <textarea
            rows={2}
            placeholder="Notes"
            defaultValue={app.notes ?? ""}
            onBlur={(event) => onUpdate({ notes: event.target.value })}
          />
          <div className="trackedJobDetails">
            <strong>Job details</strong>
            <div className="trackedJobEdit">
              <label>
                <span>Company</span>
                <input defaultValue={app.company} onBlur={(event) => onUpdate({ company: event.target.value })} />
              </label>
              <label>
                <span>Role</span>
                <input defaultValue={app.role} onBlur={(event) => onUpdate({ role: event.target.value })} />
              </label>
              <label>
                <span>Job URL</span>
                <input defaultValue={app.jobUrl} onBlur={(event) => onUpdate({ jobUrl: event.target.value })} />
              </label>
              <label>
                <span>Source</span>
                <input defaultValue={app.source} onBlur={(event) => onUpdate({ source: event.target.value })} />
              </label>
              <label>
                <span>Date applied</span>
                <input type="date" defaultValue={app.dateApplied.slice(0, 10)} onBlur={(event) => onUpdate({ dateApplied: new Date(`${event.target.value}T00:00:00`).toISOString() })} />
              </label>
              <label>
                <span>Location</span>
                <input defaultValue={app.location ?? ""} onBlur={(event) => onUpdate({ location: event.target.value })} />
              </label>
              <label>
                <span>Work mode</span>
                <select defaultValue={app.workMode ?? ""} onChange={(event) => onUpdate({ workMode: event.target.value as Application["workMode"] })}>
                  <option value="">Not set</option>
                  <option value="Remote">Remote</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="On-site">On-site</option>
                </select>
              </label>
              <label>
                <span>Resume version</span>
                <input defaultValue={app.resumeVersion ?? ""} onBlur={(event) => onUpdate({ resumeVersion: event.target.value })} />
              </label>
              <label className="trackedJobWide">
                <span>Compensation</span>
                <input defaultValue={app.compensation?.text ?? ""} onBlur={(event) => updateCompensation({ text: event.target.value })} />
              </label>
              <label>
                <span>Currency</span>
                <select defaultValue={app.compensation?.currency ?? ""} onChange={(event) => updateCompensation({ currency: event.target.value as CompensationCurrency })}>
                  <option value="">Not set</option>
                  <option value="MXN">MXN</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
              <label>
                <span>Period</span>
                <select defaultValue={app.compensation?.period ?? ""} onChange={(event) => updateCompensation({ period: event.target.value as CompensationPeriod })}>
                  <option value="">Not set</option>
                  <option value="year">Year</option>
                  <option value="month">Month</option>
                  <option value="hour">Hour</option>
                  <option value="one-time">One-time</option>
                </select>
              </label>
              <label>
                <span>Minimum</span>
                <input type="number" defaultValue={app.compensation?.min ?? ""} onBlur={(event) => updateCompensation({ min: event.target.value === "" ? null : Number(event.target.value) })} />
              </label>
              <label>
                <span>Maximum</span>
                <input type="number" defaultValue={app.compensation?.max ?? ""} onBlur={(event) => updateCompensation({ max: event.target.value === "" ? null : Number(event.target.value) })} />
              </label>
              <label className="trackedJobWide">
                <span>Job description</span>
                <textarea rows={5} defaultValue={app.jobDescription ?? ""} onBlur={(event) => onUpdate({ jobDescription: event.target.value })} />
              </label>
            </div>
            <div className="trackedJobAnswers">
              <strong>Answers used ({app.answersUsed.length})</strong>
              {app.answersUsed.length === 0 && <p>None saved for this application.</p>}
              {app.answersUsed.map((answer, index) => (
                <div className="trackedJobAnswer" key={`${index}-${answer.question}`}>
                  <label>
                    <span>Question</span>
                    <textarea rows={2} defaultValue={answer.question} onBlur={(event) => updateAnswer(index, "question", event.target.value)} />
                  </label>
                  <label>
                    <span>Answer</span>
                    <textarea rows={3} defaultValue={answer.answer} onBlur={(event) => updateAnswer(index, "answer", event.target.value)} />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </article>
  );
}

createRoot(document.getElementById("root")!).render(<SidePanel />);
