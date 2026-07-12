import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarClock, ClipboardCopy, ClipboardPaste, LayoutDashboard, MessageSquareText, Plus, Wand2 } from "lucide-react";
import { draftApplicationFromJobPosting, draftSingleAnswer } from "../../lib/ai";
import { normalizeCompensationCurrency } from "../../lib/compensation";
import { sendAutofillMessage } from "../../lib/autofill";
import { db } from "../../lib/db";
import type { ApplicationStatus, CompensationCurrency, CompensationPeriod } from "../../lib/schema";
import { getPendingApplications, getProfile, getSettings } from "../../lib/storage";
import { applyTheme } from "../../lib/theme";
import "./styles.css";

type SidePanelStats = {
  weekCount: number;
  dueCount: number;
  pendingCount: number;
};

const statuses: ApplicationStatus[] = ["Saved", "Applied", "Screen", "Interview", "Offer", "Rejected", "Ghosted"];
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
  const [stats, setStats] = useState<SidePanelStats>({ weekCount: 0, dueCount: 0, pendingCount: 0 });
  const [trackOpen, setTrackOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(emptyManualDraft);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [postingText, setPostingText] = useState("");
  const [answerOpen, setAnswerOpen] = useState(false);
  const [answerQuestion, setAnswerQuestion] = useState("");
  const [draftedAnswer, setDraftedAnswer] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    void loadInitialState();

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local" || !changes.settings) return;
      void applySavedTheme();
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  async function loadInitialState() {
    await Promise.all([loadStats(), applySavedTheme()]);
  }

  async function applySavedTheme() {
    const settings = await getSettings();
    applyTheme(settings.theme);
  }

  async function loadStats() {
    const [applications, pendingApplications] = await Promise.all([
      db.applications.toArray(),
      getPendingApplications()
    ]);
    const now = Date.now();
    setStats({
      weekCount: applications.filter((app) => now - new Date(app.dateApplied).getTime() < 7 * 24 * 60 * 60 * 1000).length,
      dueCount: applications.filter((app) => app.nextActionDate && new Date(app.nextActionDate) <= new Date()).length,
      pendingCount: pendingApplications.length
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
      await loadStats();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function addPastedApplication() {
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
      setPostingText("");
      setPasteOpen(false);
      setStatus(`Tracked ${draft.company || "Company"} - ${draft.role || "Role"}.`);
      await loadStats();
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

  return (
    <main className="sidePanelShell">
      <header className="sidePanelHeader">
        <div>
          <p>Job Autofill</p>
          <h1>Quick desk</h1>
        </div>
        <button className="dashboardIcon" title="Open dashboard" onClick={() => void openDashboard()}>
          <LayoutDashboard size={17} />
        </button>
      </header>

      <section className="statGrid" aria-label="Tracking summary">
        <Stat label="Week" value={stats.weekCount} />
        <Stat label="Due" value={stats.dueCount} />
        <Stat label="Pending" value={stats.pendingCount} />
      </section>

      <button className="autofillButton" onClick={() => void autofillCurrentPage()}>
        <Wand2 size={16} />
        Autofill page
      </button>

      <button className="trackButton" onClick={() => setTrackOpen(!trackOpen)}>
        <CalendarClock size={16} />
        Track
      </button>

      <button className="answerButton" onClick={() => setAnswerOpen(!answerOpen)}>
        <MessageSquareText size={16} />
        Answer
      </button>

      {trackOpen && (
        <section className="trackPanel">
          <div className="trackActions">
            <button onClick={toggleManualMode}>
              <Plus size={15} />
              Manual
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
              <button onClick={() => void addPastedApplication()}>Create tracker row</button>
            </div>
          )}
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

      <button className="dashboardButton" onClick={() => void openDashboard()}>
        <LayoutDashboard size={16} />
        Dashboard
      </button>

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

function numberOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<SidePanel />);
