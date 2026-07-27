import { useCallback, useEffect, useState } from "react";
import type { JobPostingDraft } from "../../lib/ai";
import { normalizeCompensationCurrency } from "../../lib/compensation";
import { isFollowUpDue, localTodayISO } from "../../lib/jobs";
import { changeUpworkStatus, UPWORK_PROPOSAL_STATUSES } from "../../lib/upwork";
import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationStatus,
  type CompensationCurrency,
  type CompensationPeriod,
  type ExtensionMessage,
  type UpworkProposalStatus
} from "../../lib/schema";

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

export default function TrackerTab({ demoMode, onOpenDashboard }: { demoMode: boolean; onOpenDashboard: () => void }) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TrackerStatusFilter>("All");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(emptyManualDraft);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [postingText, setPostingText] = useState("");
  const [pasteCreating, setPasteCreating] = useState(false);
  const [dueOnly, setDueOnly] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({ kind: "LIST_APPLICATIONS" } satisfies ExtensionMessage);
    if (!response?.ok) throw new Error(response?.error ?? "Loading tracked jobs failed.");
    setApplications(response.applications as Application[]);
  }, []);

  useEffect(() => {
    load().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (changes.applicationsRev) {
        void load().catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    return () => chrome.storage.onChanged.removeListener(onStorage);
  }, [load]);

  async function addManual() {
    if (!manualDraft.company.trim() || !manualDraft.role.trim()) {
      setNotice("Company and role are required.");
      return;
    }
    setNotice("Creating...");
    try {
      const application: Application = {
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
      const response = await chrome.runtime.sendMessage({ kind: "LOG_APPLICATION", application } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Creating the tracker row failed.");
      setManualDraft(emptyManualDraft);
      setManualOpen(false);
      setNotice(demoMode ? "Demo mode: not saved." : "Manual tracker row created.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function addPasted() {
    if (pasteCreating) return;
    setPasteCreating(true);
    setNotice("Reading posting...");
    try {
      const draftResponse = await chrome.runtime.sendMessage({
        kind: "AI_DRAFT_APPLICATION",
        postingText,
        pageUrl: location.href
      } satisfies ExtensionMessage);
      if (!draftResponse?.ok) throw new Error(draftResponse?.error ?? "Reading the posting failed.");
      const draft = draftResponse.draft as JobPostingDraft;
      const application: Application = {
        company: draft.company,
        role: draft.role,
        jobUrl: draft.jobUrl || location.href,
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
      const response = await chrome.runtime.sendMessage({ kind: "LOG_APPLICATION", application } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Creating the tracker row failed.");
      setPostingText("");
      setPasteOpen(false);
      setNotice(demoMode ? "Demo mode: not saved." : `Tracked ${draft.company || "Company"} - ${draft.role || "Role"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setPasteCreating(false);
    }
  }

  async function updateApplication(app: Application, patch: Partial<Application>) {
    try {
      if (!app.id) throw new Error("Tracked job is missing an id.");
      const response = await chrome.runtime.sendMessage({ kind: "UPDATE_APPLICATION", id: app.id, patch } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Updating the tracked job failed.");
      setNotice(demoMode ? "Demo mode: not saved." : "Tracked job updated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteApplication(app: Application) {
    try {
      if (!app.id) throw new Error("Tracked job is missing an id.");
      const response = await chrome.runtime.sendMessage({ kind: "DELETE_APPLICATION", id: app.id } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Deleting the tracked job failed.");
      setNotice(demoMode ? "Demo mode: not saved." : "Tracked job deleted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  const now = Date.now();
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const stats = {
    dayCount: applications.filter((app) => isSameLocalDay(new Date(app.dateApplied), today)).length,
    yesterdayCount: applications.filter((app) => isSameLocalDay(new Date(app.dateApplied), yesterday)).length,
    weekCount: applications.filter((app) => now - new Date(app.dateApplied).getTime() < 7 * 24 * 60 * 60 * 1000).length
  };

  const todayISO = localTodayISO();
  const dueApplications = applications.filter((app) => isFollowUpDue(app, todayISO));

  const visibleApplications = applications.filter((app) => {
    const trimmed = query.trim().toLowerCase();
    const matchesQuery = !trimmed || `${app.company} ${app.role} ${app.source} ${app.status} ${app.notes}`.toLowerCase().includes(trimmed);
    const matchesStatus = statusFilter === "All" || app.status === statusFilter;
    const matchesDue = !dueOnly || isFollowUpDue(app, todayISO);
    return matchesQuery && matchesStatus && matchesDue;
  });

  return (
    <div className="jtMatch">
      {dueApplications.length > 0 && (
        <button className={dueOnly ? "jtDueBanner jtDueBannerActive" : "jtDueBanner"} onClick={() => setDueOnly(!dueOnly)}>
          {dueApplications.length} follow-up{dueApplications.length === 1 ? "" : "s"} due
          {dueOnly ? " - showing only these" : " - click to filter"}
        </button>
      )}
      <div className="jtStatRow">
        <Stat label="Today" value={stats.dayCount} />
        <Stat label="Yesterday" value={stats.yesterdayCount} />
        <Stat label="Week" value={stats.weekCount} />
      </div>
      <div className="jtRow">
        <button
          className={manualOpen ? "jtButton" : "jtButtonGhost"}
          onClick={() => {
            setManualOpen(!manualOpen);
            if (!manualOpen) setPasteOpen(false);
          }}
        >
          + New job
        </button>
        <button
          className={pasteOpen ? "jtButton" : "jtButtonGhost"}
          onClick={() => {
            setPasteOpen(!pasteOpen);
            if (!pasteOpen) setManualOpen(false);
          }}
        >
          Paste AI
        </button>
      </div>
      {manualOpen && (
        <div className="jtMatch">
          <label className="jtField">
            <span>Company</span>
            <input value={manualDraft.company} onChange={(event) => setManualDraft({ ...manualDraft, company: event.target.value })} />
          </label>
          <label className="jtField">
            <span>Role</span>
            <input value={manualDraft.role} onChange={(event) => setManualDraft({ ...manualDraft, role: event.target.value })} />
          </label>
          <label className="jtField">
            <span>Job URL</span>
            <input value={manualDraft.jobUrl} onChange={(event) => setManualDraft({ ...manualDraft, jobUrl: event.target.value })} />
          </label>
          <label className="jtField">
            <span>Compensation</span>
            <input value={manualDraft.compensationText} onChange={(event) => setManualDraft({ ...manualDraft, compensationText: event.target.value })} />
          </label>
          <div className="jtGrid2">
            <label className="jtField">
              <span>Source</span>
              <input value={manualDraft.source} onChange={(event) => setManualDraft({ ...manualDraft, source: event.target.value })} />
            </label>
            <label className="jtField">
              <span>Status</span>
              <select value={manualDraft.status} onChange={(event) => setManualDraft({ ...manualDraft, status: event.target.value as ApplicationStatus })}>
                {APPLICATION_STATUSES.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="jtGrid3">
            <label className="jtField">
              <span>Currency</span>
              <select
                value={manualDraft.compensationCurrency}
                onChange={(event) => setManualDraft({ ...manualDraft, compensationCurrency: event.target.value as CompensationCurrency })}
              >
                <option value="">Not set</option>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </label>
            <label className="jtField">
              <span>Min</span>
              <input
                inputMode="decimal"
                value={manualDraft.compensationMin}
                onChange={(event) => setManualDraft({ ...manualDraft, compensationMin: event.target.value })}
              />
            </label>
            <label className="jtField">
              <span>Max</span>
              <input
                inputMode="decimal"
                value={manualDraft.compensationMax}
                onChange={(event) => setManualDraft({ ...manualDraft, compensationMax: event.target.value })}
              />
            </label>
          </div>
          <label className="jtField">
            <span>Period</span>
            <select
              value={manualDraft.compensationPeriod}
              onChange={(event) => setManualDraft({ ...manualDraft, compensationPeriod: event.target.value as CompensationPeriod })}
            >
              <option value="">Not set</option>
              <option value="year">Year</option>
              <option value="month">Month</option>
              <option value="hour">Hour</option>
              <option value="one-time">One-time</option>
            </select>
          </label>
          <button className="jtButton" onClick={() => void addManual()}>
            Create tracker row
          </button>
        </div>
      )}
      {pasteOpen && (
        <div className="jtMatch">
          <textarea
            className="jtTextarea"
            rows={5}
            placeholder="Paste a job posting or Upwork proposal summary"
            value={postingText}
            onChange={(event) => setPostingText(event.target.value)}
          />
          <button className="jtButton" disabled={pasteCreating || !postingText.trim()} onClick={() => void addPasted()}>
            {pasteCreating ? "Reading..." : "Create with AI"}
          </button>
        </div>
      )}
      <div className="jtRow">
        <input
          className="jtTextarea"
          aria-label="Search tracked jobs"
          placeholder="Search jobs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="jtTextarea"
          aria-label="Filter tracked jobs by status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as TrackerStatusFilter)}
        >
          <option value="All">All</option>
          {APPLICATION_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </div>
      <p className="jtMuted">{visibleApplications.length} tracked</p>
      {applications.length === 0 && <p className="jtMuted">New and tracked jobs will show here.</p>}
      {applications.length > 0 && visibleApplications.length === 0 && <p className="jtMuted">No tracked jobs match this view.</p>}
      {visibleApplications.map((app) => (
        <TrackedJob
          app={app}
          key={app.id ?? `${app.company}-${app.role}-${app.dateApplied}`}
          onUpdate={(patch) => void updateApplication(app, patch)}
          onDelete={() => void deleteApplication(app)}
          onOpenDashboard={onOpenDashboard}
        />
      ))}
      {notice && <p className="jtNotice">{notice}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="jtStat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TrackedJob({
  app,
  onUpdate,
  onDelete,
  onOpenDashboard
}: {
  app: Application;
  onUpdate: (patch: Partial<Application>) => void;
  onDelete: () => void;
  onOpenDashboard: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = window.setTimeout(() => setConfirmingDelete(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmingDelete]);

  async function copyJob() {
    await navigator.clipboard.writeText(applicationToClipboardText(app));
    setCopied(true);
  }

  return (
    <article className="jtJobRow">
      <div className="jtJobRowTop">
        <button className="jtMiniButton" type="button" title={expanded ? "Collapse job" : "Expand job"} onClick={() => setExpanded(!expanded)}>
          {expanded ? "-" : "+"}
        </button>
        <div className="jtJobRowMain">
          <div className="jtJobRowTitle">
            <strong>{app.role || "Role"}</strong>
            <select
              aria-label={`Status for ${app.role || "tracked job"}`}
              value={app.status}
              onChange={(event) => onUpdate({ status: event.target.value as ApplicationStatus })}
            >
              {APPLICATION_STATUSES.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </div>
          <p className="jtJobRowCompany">{app.company || "Company"}</p>
          {app.upwork && <span className="jtUpworkBadge">Upwork · {app.upwork.status}</span>}
          {app.nextActionDate && <p className="jtJobRowCompany">Due {app.nextActionDate.slice(0, 10)}</p>}
        </div>
        <div className="jtJobRowActions">
          <button className="jtMiniButton" type="button" title="Copy all job details" onClick={() => void copyJob()}>
            {copied ? "Copied" : "Copy"}
          </button>
          {app.jobUrl ? (
            <a className="jtMiniButton" href={app.jobUrl} target="_blank" rel="noreferrer" title="Open job">
              Open
            </a>
          ) : null}
        </div>
      </div>
      {expanded && (
        <div className="jtJobRowExpanded">
          <label className="jtField">
            <span>Follow-up date</span>
            <input
              type="date"
              value={app.nextActionDate?.slice(0, 10) ?? ""}
              onChange={(event) => onUpdate({ nextActionDate: event.target.value })}
            />
          </label>
          {app.upwork && (
            <>
              <label className="jtField">
                <span>Upwork proposal status</span>
                <select
                  value={app.upwork.status}
                  onChange={(event) => onUpdate(changeUpworkStatus(app, event.target.value as UpworkProposalStatus))}
                >
                  {UPWORK_PROPOSAL_STATUSES.map((proposalStatus) => (
                    <option key={proposalStatus}>{proposalStatus}</option>
                  ))}
                </select>
              </label>
              <div className="jtGrid2">
                <label className="jtField">
                  <span>Base Connects</span>
                  <input
                    type="number"
                    min="0"
                    value={app.upwork.baseConnects ?? ""}
                    onChange={(event) => onUpdate({ upwork: { ...app.upwork!, baseConnects: nullableNumber(event.target.value) } })}
                  />
                </label>
                <label className="jtField">
                  <span>Boost charged</span>
                  <input
                    type="number"
                    min="0"
                    value={app.upwork.boostCharged ?? ""}
                    onChange={(event) => onUpdate({ upwork: { ...app.upwork!, boostCharged: nullableNumber(event.target.value) } })}
                  />
                </label>
              </div>
            </>
          )}
          <label className="jtField">
            <span>Notes</span>
            <textarea
              className="jtTextarea"
              rows={2}
              defaultValue={app.notes ?? ""}
              onBlur={(event) => {
                if (event.target.value !== (app.notes ?? "")) onUpdate({ notes: event.target.value });
              }}
            />
          </label>
          <div className="jtRow">
            <button className="jtMiniButton" type="button" onClick={onOpenDashboard}>
              Edit in dashboard
            </button>
            <button
              className="jtMiniButton jtMiniDanger"
              type="button"
              onClick={() => {
                if (confirmingDelete) {
                  setConfirmingDelete(false);
                  onDelete();
                } else {
                  setConfirmingDelete(true);
                }
              }}
            >
              {confirmingDelete ? "Confirm delete?" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </article>
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

function applicationToClipboardText(application: Application): string {
  const compensation = application.compensation;
  return [
    `${application.role || "Untitled role"} at ${application.company || "Unknown company"}`,
    [
      `Company: ${application.company}`,
      `Role: ${application.role}`,
      `Status: ${application.status}`,
      `Source: ${application.source}`,
      `Job URL: ${application.jobUrl}`,
      `Date applied: ${application.dateApplied.slice(0, 10)}`,
      application.nextActionDate ? `Next action date: ${application.nextActionDate.slice(0, 10)}` : "",
      application.location ? `Location: ${application.location}` : "",
      application.workMode ? `Work mode: ${application.workMode}` : "",
      application.resumeVersion ? `Resume version: ${application.resumeVersion}` : ""
    ].filter(Boolean).join("\n"),
    compensation
      ? [
          "Compensation",
          compensation.text ? `Details: ${compensation.text}` : "",
          compensation.currency ? `Currency: ${compensation.currency}` : "",
          compensation.min != null ? `Minimum: ${compensation.min}` : "",
          compensation.max != null ? `Maximum: ${compensation.max}` : "",
          compensation.period ? `Period: ${compensation.period}` : ""
        ].filter(Boolean).join("\n")
      : "",
    application.notes ? `Notes\n${application.notes}` : "",
    application.jobDescription ? `Job description\n${application.jobDescription}` : "",
    application.answersUsed.length > 0
      ? `Application answers\n${application.answersUsed.map((item) => `Question: ${item.question}\nAnswer: ${item.answer}`).join("\n\n")}`
      : ""
  ].filter(Boolean).join("\n\n");
}

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function nullableNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid non-negative number: ${value}`);
  return parsed;
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}
