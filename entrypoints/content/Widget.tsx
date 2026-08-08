import { useCallback, useEffect, useRef, useState } from "react";
import { scoreAffinity, type AffinityResult } from "../../lib/affinity";
import type { JobFitAnalysis, JobPostingDraft } from "../../lib/ai";
import { isJobDetailUrl } from "../../lib/jobs";
import { getDueCount, getProfile, getSettings, saveProfile } from "../../lib/storage";
import { changeUpworkStatus, UPWORK_PROPOSAL_STATUSES } from "../../lib/upwork";
import {
  type Application,
  type ExtensionMessage,
  type PageContext,
  type PendingApplication,
  type Profile,
  type Settings,
  type TrackingEntryMode,
  type UpworkProposalDetails,
  type UpworkProposalStatus
} from "../../lib/schema";
import { buildCurrentApplication, extractJobDescription, extractUpworkProposalDetails, getPageContext, hasJobDescriptionSurface } from "./engine";
import ProfileTab from "./ProfileTab";
import TrackerTab from "./TrackerTab";

type JobState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "scored"; affinity: AffinityResult }
  | { phase: "error"; message: string };

type TabId = "match" | "answer" | "upwork" | "tracker" | "profile";

const JOB_DESCRIPTION_TIMEOUT_MS = 10_000;

const TAB_LABELS: Record<TabId, string> = {
  match: "Match",
  answer: "Answer",
  upwork: "Upwork",
  tracker: "Tracker",
  profile: "Profile"
};

export default function Widget({ showFab = true }: { showFab?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile>();
  const [settings, setSettings] = useState<Settings>();
  const [url, setUrl] = useState(location.href);
  const [page, setPage] = useState<PageContext>();
  const [job, setJob] = useState<JobState>({ phase: "idle" });
  const [tracked, setTracked] = useState<Application>();
  const [trackNotice, setTrackNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [trackFormOpen, setTrackFormOpen] = useState(false);
  const [trackEntryMode, setTrackEntryMode] = useState<TrackingEntryMode>("manual");
  const [postingText, setPostingText] = useState("");
  const [trackDraft, setTrackDraft] = useState<Application>();
  const [readingPosting, setReadingPosting] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<PendingApplication>();
  const [activeTab, setActiveTab] = useState<TabId>("tracker");
  const [dueCount, setDueCount] = useState(0);

  const showMatch = isJobDetailUrl(url) && (settings?.matchScoring ?? false);
  const isUpwork = location.hostname.includes("upwork.com");
  const tabs: TabId[] = [
    ...(showMatch ? (["match"] as const) : []),
    "tracker",
    "answer",
    ...(isUpwork ? (["upwork"] as const) : []),
    "profile"
  ];

  useEffect(() => {
    void getProfile().then(setProfile);
    void getSettings().then(setSettings);
    void getDueCount().then(setDueCount);
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      if (changes.profile || changes.settings) {
        void getProfile().then(setProfile);
        void getSettings().then(setSettings);
      }
      if (changes.dueCount) setDueCount((changes.dueCount.newValue as number | undefined) ?? 0);
    };
    chrome.storage.onChanged.addListener(onStorage);
    // SPA navigation (LinkedIn/Indeed/Upwork) never reloads the page, so poll the URL.
    const urlWatcher = window.setInterval(() => {
      setUrl((current) => (current === location.href ? current : location.href));
    }, 1000);
    const onMessage = (message: ExtensionMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      if (message.kind === "SHOW_TRACK_CONFIRM") {
        setPendingConfirm(message.pending);
        setOpen(true);
        sendResponse({ ok: true });
      }
      if (message.kind === "TOGGLE_WIDGET") {
        setOpen((value) => !value);
        sendResponse({ ok: true });
      }
      return false;
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      chrome.storage.onChanged.removeListener(onStorage);
      chrome.runtime.onMessage.removeListener(onMessage);
      window.clearInterval(urlWatcher);
    };
  }, []);

  useEffect(() => {
    setTrackNotice("");
    const matchEnabled = isJobDetailUrl(url) && (settings?.matchScoring ?? false);
    setActiveTab(matchEnabled ? "match" : "tracker");
    if (!profile) return;
    if (!matchEnabled) {
      setPage(getPageContext());
      setJob({ phase: "idle" });
      return;
    }
    setJob({ phase: "loading" });
    let cancelled = false;
    let retryTimer = 0;
    let mutationTimer = 0;
    let descriptionFound = false;
    let lastDescription = "";
    const startedAt = Date.now();
    const scoreCurrentDescription = () => {
      if (cancelled) return;
      if (hasJobDescriptionSurface()) {
        const description = extractJobDescription();
        descriptionFound = true;
        if (description === lastDescription) return;
        lastDescription = description;
        setPage(getPageContext());
        setJob({ phase: "scored", affinity: scoreAffinity(profile, description) });
      }
    };
    const attempt = () => {
      if (cancelled) return;
      scoreCurrentDescription();
      if (descriptionFound) {
        return;
      }
      if (Date.now() - startedAt >= JOB_DESCRIPTION_TIMEOUT_MS) {
        setPage(getPageContext());
        setJob({ phase: "error", message: "Couldn't read the job description on this page." });
        return;
      }
      retryTimer = window.setTimeout(attempt, 500);
    };
    const observer = new MutationObserver(() => {
      window.clearTimeout(mutationTimer);
      mutationTimer = window.setTimeout(scoreCurrentDescription, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    retryTimer = window.setTimeout(attempt, 0);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearTimeout(retryTimer);
      window.clearTimeout(mutationTimer);
    };
  }, [url, profile, settings?.matchScoring]);

  useEffect(() => {
    setTrackFormOpen(false);
    setPostingText("");
    setTrackDraft(undefined);
  }, [url]);

  useEffect(() => {
    setTracked(undefined);
    let cancelled = false;
    void chrome.runtime
      .sendMessage({ kind: "GET_TRACKED_JOB", url } satisfies ExtensionMessage)
      .then((response) => {
        if (!cancelled && response?.ok) setTracked(response.tracked);
      });
    return () => {
      cancelled = true;
    };
  }, [url, open]);

  const saveApplication = useCallback(async (draft: Application) => {
    const application = { ...draft, status: "Applied" as const };
    setSaving(true);
    setTrackNotice("");
    try {
      const response = await chrome.runtime.sendMessage({ kind: "LOG_APPLICATION", application } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Tracking failed.");
      if (settings?.demoMode) {
        setTrackNotice("Demo mode: not saved.");
      } else {
        setTracked(application);
        setTrackFormOpen(false);
        setPostingText("");
        setTrackDraft(undefined);
        setTrackNotice("Tracked as Applied.");
      }
    } catch (error) {
      setTrackNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [settings]);

  // AI mode saves straight from the pasted text. The draft form only appears when
  // AI came back without a company or role, which cannot be saved as-is.
  const readPosting = useCallback(async () => {
    setReadingPosting(true);
    setTrackNotice("");
    try {
      const response = await chrome.runtime.sendMessage({
        kind: "AI_DRAFT_APPLICATION",
        postingText
      } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "AI could not read the job text.");
      const draft = response.draft as JobPostingDraft;
      const application: Application = {
        company: draft.company,
        role: draft.role,
        jobUrl: draft.jobUrl,
        source: draft.source,
        dateApplied: new Date().toISOString(),
        status: "Applied",
        location: draft.location,
        workMode: draft.workMode,
        compensation: draft.compensation,
        jobDescription: draft.jobDescription,
        answersUsed: [],
        notes: "",
        upwork: draft.upwork
      };
      if (!application.company.trim() || !application.role.trim()) {
        setTrackDraft(application);
        setTrackNotice("AI could not read the company or role. Fill them in, then save.");
        return;
      }
      await saveApplication(application);
    } catch (error) {
      setTrackNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setReadingPosting(false);
    }
  }, [postingText, saveApplication]);

  const trackJob = useCallback(async () => {
    if (!trackDraft) return;
    if (!trackDraft.company.trim() || !trackDraft.role.trim()) {
      setTrackNotice("Company and role are required.");
      return;
    }
    await saveApplication(trackDraft);
  }, [saveApplication, trackDraft]);

  const openTrackForm = () => {
    const mode = settings?.trackingEntryMode ?? "manual";
    setTrackEntryMode(mode);
    setPostingText("");
    setTrackDraft(mode === "manual" ? emptyTrackingApplication() : undefined);
    setTrackNotice("");
    setTrackFormOpen(true);
  };

  const changeTrackEntryMode = (mode: TrackingEntryMode) => {
    setTrackEntryMode(mode);
    setPostingText("");
    setTrackDraft(mode === "manual" ? emptyTrackingApplication() : undefined);
    setTrackNotice("");
  };

  const openDashboard = (applicationId?: number) => {
    void chrome.runtime.sendMessage({ kind: "OPEN_DASHBOARD", applicationId } satisfies ExtensionMessage);
  };

  const addSkill = useCallback(
    async (term: string) => {
      if (!profile) return;
      try {
        await saveProfile({ ...profile, skills: { ...profile.skills, [term]: { years: 0, note: "" } } });
        setTrackNotice(`Added "${term}" to your profile skills.`);
      } catch (error) {
        setTrackNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [profile]
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const theme = settings?.theme ?? "light";
  const score = job.phase === "scored" && job.affinity.jobTermCount > 0 ? job.affinity.score : undefined;

  return (
    <div className="jtRoot" data-theme={theme}>
      {open && (
        <section className="jtDrawer">
          <header className="jtHeader">
            <div>
              <p className="jtKicker">{page?.source ?? "Job page"}</p>
              <h1 className="jtTitle">{page?.role ?? "Current page"}</h1>
              {page?.company && <p className="jtCompany">{page.company}</p>}
            </div>
            <button className="jtIconButton" onClick={() => setOpen(false)} aria-label="Close">
              x
            </button>
          </header>
          {settings?.demoMode && <p className="jtDemoBadge">Demo mode</p>}
          {pendingConfirm ? (
            <div className="jtDrawerBody">
              <TrackConfirm
                pending={pendingConfirm}
                demoMode={settings?.demoMode ?? false}
                defaultMode={settings?.trackingEntryMode ?? "manual"}
                onDone={(application, notice) => {
                  setPendingConfirm(undefined);
                  if (application) setTracked(application);
                  setTrackNotice(notice);
                }}
              />
            </div>
          ) : (
            <>
              <nav className="jtTabs">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    className={tab === activeTab ? "jtTab jtTabActive" : "jtTab"}
                    onClick={() => setActiveTab(tab)}
                  >
                    {TAB_LABELS[tab]}
                  </button>
                ))}
              </nav>
              <div className="jtDrawerBody">
                {activeTab === "match" && (
                  <>
                    {job.phase === "loading" && <p className="jtMuted">Reading job description...</p>}
                    {job.phase === "error" && <p className="jtError">{job.message}</p>}
                    {job.phase === "scored" && page && (
                      <MatchTab affinity={job.affinity} page={page} url={url} onAddSkill={(term) => void addSkill(term)} />
                    )}
                  </>
                )}
                {activeTab === "answer" && <AnswerTab />}
                {activeTab === "upwork" && (
                  <UpworkTab
                    url={url}
                    tracked={tracked}
                    demoMode={settings?.demoMode ?? false}
                    onTracked={setTracked}
                    onPatched={(patch) => setTracked((current) => (current ? { ...current, ...patch } : current))}
                  />
                )}
                {activeTab === "tracker" && <TrackerTab demoMode={settings?.demoMode ?? false} onOpenDashboard={openDashboard} />}
                {activeTab === "profile" && <ProfileTab demoMode={settings?.demoMode ?? false} onOpenDashboard={openDashboard} />}
              </div>
              <footer className="jtDrawerFooter">
                {!tracked && trackFormOpen && (
                  <div className="jtTrackForm">
                    <TrackingModeSwitch mode={trackEntryMode} onChange={changeTrackEntryMode} />
                    {trackEntryMode === "ai" && !trackDraft ? (
                      <>
                        <label htmlFor="jt-job-posting">Job text for AI</label>
                        <textarea
                          id="jt-job-posting"
                          value={postingText}
                          onChange={(event) => setPostingText(event.target.value)}
                          placeholder="Paste the job post or any text you want AI to use to fill the tracker."
                          rows={5}
                          autoFocus
                        />
                        <p>Only this pasted text is sent to AI. Nothing is read automatically from the current page.</p>
                      </>
                    ) : trackDraft ? (
                      <TrackDraftForm draft={trackDraft} mode={trackEntryMode} onChange={setTrackDraft} />
                    ) : null}
                  </div>
                )}
                <div className="jtFooter">
                  {activeTab === "tracker" ? (
                    <p className="jtTracked">Editing tracked jobs</p>
                  ) : tracked ? (
                    <p className="jtTracked">Tracked: {tracked.status}</p>
                  ) : trackFormOpen ? (
                    <>
                      <button
                        className="jtButton"
                        onClick={() => void (trackDraft ? trackJob() : readPosting())}
                        disabled={saving || readingPosting || (!trackDraft && !postingText.trim())}
                      >
                        {saving ? "Saving..." : readingPosting ? "Reading with AI..." : trackDraft ? "Save as applied" : "Track with AI"}
                      </button>
                      <button
                        className="jtButtonGhost"
                        onClick={() => {
                          if (trackEntryMode === "ai" && trackDraft) {
                            setTrackDraft(undefined);
                            setTrackNotice("");
                          } else {
                            setTrackFormOpen(false);
                          }
                        }}
                        disabled={saving || readingPosting}
                      >
                        {trackEntryMode === "ai" && trackDraft ? "Back" : "Cancel"}
                      </button>
                    </>
                  ) : (
                    <button className="jtButton" onClick={openTrackForm}>
                      Track this job
                    </button>
                  )}
                  <button className="jtButtonGhost" onClick={() => openDashboard()}>
                    Open dashboard
                  </button>
                </div>
                {trackNotice && <p className="jtNotice">{trackNotice}</p>}
              </footer>
            </>
          )}
        </section>
      )}
      {!open && showFab && (
        <button className={fabClass(score)} onClick={() => setOpen(true)} title="Job Autofill + Tracker">
          {score !== undefined ? score : "JT"}
          {dueCount > 0 && <span className="jtFabDot" title={`${dueCount} follow-ups due`} />}
        </button>
      )}
    </div>
  );
}

function fabClass(score: number | undefined): string {
  if (score === undefined) return "jtFab";
  if (score >= 70) return "jtFab jtFabHigh";
  if (score >= 40) return "jtFab jtFabMid";
  return "jtFab jtFabLow";
}

function MatchTab({
  affinity,
  page,
  url,
  onAddSkill
}: {
  affinity: AffinityResult;
  page: PageContext;
  url: string;
  onAddSkill: (term: string) => void;
}) {
  const [analysis, setAnalysis] = useState<JobFitAnalysis>();
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  useEffect(() => {
    setAnalysis(undefined);
    setAnalysisError("");
  }, [url]);

  const runDeepAnalysis = async () => {
    setAnalyzing(true);
    setAnalysisError("");
    try {
      const request: ExtensionMessage = { kind: "AI_JOB_FIT", jobDescription: extractJobDescription(), page };
      const response = await chrome.runtime.sendMessage(request);
      if (!response?.ok) throw new Error(response?.error ?? "Analysis failed.");
      setAnalysis(response.analysis as JobFitAnalysis);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzing(false);
    }
  };

  if (affinity.jobTermCount === 0) {
    return <p className="jtMuted">No recognizable skills found in this posting.</p>;
  }
  const coveredCount = affinity.jobTermCount - affinity.missing.length;
  return (
    <div className="jtMatch">
      <div className="jtScoreRow">
        <span className="jtScore">{affinity.score}</span>
        <span className="jtScoreLabel">
          {coveredCount} of {affinity.jobTermCount} skills matched
        </span>
      </div>
      {affinity.matched.length > 0 && (
        <div className="jtChipGroup">
          <p className="jtChipHeading">Your matching skills</p>
          <div className="jtChips">
            {affinity.matched.map((item) => (
              <span key={item.term} className="jtChip jtChipMatched" title={item.source}>
                {item.term}
              </span>
            ))}
          </div>
        </div>
      )}
      {affinity.missing.length > 0 && (
        <div className="jtChipGroup">
          <p className="jtChipHeading">Missing keywords - click to add to your profile</p>
          <div className="jtChips">
            {affinity.missing.map((term) => (
              <button
                key={term}
                className="jtChip jtChipMissing jtChipAdd"
                title={`Add "${term}" to your profile skills`}
                onClick={() => onAddSkill(term)}
              >
                + {term}
              </button>
            ))}
          </div>
        </div>
      )}
      <button className="jtButtonGhost" onClick={() => void runDeepAnalysis()} disabled={analyzing}>
        {analyzing ? "Analyzing..." : "Deep analysis (AI)"}
      </button>
      {analysisError && <p className="jtError">{analysisError}</p>}
      {analysis && (
        <div className="jtAnalysis">
          <div className="jtScoreRow">
            <span className="jtScore">{analysis.score}</span>
            <span className="jtScoreLabel">AI fit score</span>
          </div>
          <p className="jtAnalysisText">{analysis.verdict}</p>
          {analysis.strengths.length > 0 && (
            <div className="jtChipGroup">
              <p className="jtChipHeading">Strengths</p>
              <ul className="jtList">
                {analysis.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {analysis.gaps.length > 0 && (
            <div className="jtChipGroup">
              <p className="jtChipHeading">Gaps</p>
              <ul className="jtList">
                {analysis.gaps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="jtChipGroup">
            <p className="jtChipHeading">Pitch angle</p>
            <p className="jtAnalysisText">{analysis.pitchAngle}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function emptyTrackingApplication(): Application {
  return {
    company: "",
    role: "",
    jobUrl: "",
    source: "Manual",
    dateApplied: new Date().toISOString(),
    status: "Applied",
    location: "",
    workMode: "",
    jobDescription: "",
    answersUsed: [],
    notes: ""
  };
}

function TrackingModeSwitch({ mode, onChange }: { mode: TrackingEntryMode; onChange: (mode: TrackingEntryMode) => void }) {
  return (
    <div className="jtModeSwitch" aria-label="Tracking entry mode">
      <button type="button" className={mode === "manual" ? "jtModeActive" : ""} aria-pressed={mode === "manual"} onClick={() => onChange("manual")}>
        Manual
      </button>
      <button type="button" className={mode === "ai" ? "jtModeActive" : ""} aria-pressed={mode === "ai"} onClick={() => onChange("ai")}>
        AI paste
      </button>
    </div>
  );
}

function TrackDraftForm({ draft, mode, onChange }: { draft: Application; mode: TrackingEntryMode; onChange: (draft: Application) => void }) {
  const update = (patch: Partial<Application>) => onChange({ ...draft, ...patch });
  return (
    <div className="jtTrackReview">
      <div>
        <p className="jtKicker">{mode === "ai" ? "AI draft" : "Manual entry"}</p>
        <strong>Review before saving as Applied</strong>
      </div>
      <div className="jtGrid2">
        <label className="jtField">
          <span>Company</span>
          <input value={draft.company} onChange={(event) => update({ company: event.target.value })} />
        </label>
        <label className="jtField">
          <span>Role</span>
          <input value={draft.role} onChange={(event) => update({ role: event.target.value })} />
        </label>
      </div>
      <div className="jtGrid2">
        <label className="jtField">
          <span>Source</span>
          <input value={draft.source} onChange={(event) => update({ source: event.target.value })} />
        </label>
        <label className="jtField">
          <span>Work mode</span>
          <select value={draft.workMode ?? ""} onChange={(event) => update({ workMode: event.target.value as Application["workMode"] })}>
            <option value="">Not set</option>
            <option value="Remote">Remote</option>
            <option value="Hybrid">Hybrid</option>
            <option value="On-site">On-site</option>
          </select>
        </label>
      </div>
      <label className="jtField">
        <span>Location</span>
        <input value={draft.location ?? ""} onChange={(event) => update({ location: event.target.value })} />
      </label>
      <label className="jtField">
        <span>Compensation</span>
        <input
          value={draft.compensation?.text ?? ""}
          onChange={(event) => update({
            compensation: {
              text: event.target.value,
              currency: draft.compensation?.currency ?? "",
              min: draft.compensation?.min,
              max: draft.compensation?.max,
              period: draft.compensation?.period ?? ""
            }
          })}
        />
      </label>
      <label className="jtField">
        <span>Job URL</span>
        <input value={draft.jobUrl} onChange={(event) => update({ jobUrl: event.target.value })} />
      </label>
    </div>
  );
}

function AnswerTab() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const draft = async () => {
    setBusy(true);
    setError("");
    setCopied(false);
    setSaved(false);
    try {
      const response = await chrome.runtime.sendMessage({ kind: "AI_DRAFT_ANSWER", question } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Drafting failed.");
      setAnswer(response.answer as string);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(answer);
    setCopied(true);
  };

  // The original draft is auto-saved by the background; this persists edits.
  const save = async () => {
    setError("");
    try {
      const response = await chrome.runtime.sendMessage({ kind: "REMEMBER_ANSWER", question, answer } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Saving failed.");
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="jtMatch">
      <textarea
        className="jtTextarea"
        rows={4}
        placeholder="Paste the application question"
        value={question}
        onChange={(event) => {
          setQuestion(event.target.value);
          setSaved(false);
        }}
      />
      <button className="jtButton" onClick={() => void draft()} disabled={busy || !question.trim()}>
        {busy ? "Drafting..." : "Draft answer"}
      </button>
      {error && <p className="jtError">{error}</p>}
      {answer && (
        <>
          <textarea
            className="jtTextarea"
            rows={6}
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value);
              setSaved(false);
            }}
          />
          <div className="jtFooter">
            <button className="jtButtonGhost" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy answer"}
            </button>
            <button className="jtButtonGhost" onClick={() => void save()} disabled={saved || !question.trim() || !answer.trim()}>
              {saved ? "Saved to memory" : "Save answer"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function UpworkTab({
  url,
  tracked,
  demoMode,
  onTracked,
  onPatched
}: {
  url: string;
  tracked: Application | undefined;
  demoMode: boolean;
  onTracked: (application: Application) => void;
  onPatched: (patch: Partial<Application>) => void;
}) {
  const [details, setDetails] = useState<UpworkProposalDetails>(() => extractUpworkProposalDetails());
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const touchedRef = useRef(false);

  const editDetails = (next: UpworkProposalDetails) => {
    touchedRef.current = true;
    setDetails(next);
  };

  // The find-work slider loads its content asynchronously, so a one-shot extract
  // often runs before the Connects text exists. Retry until a signal field shows
  // up, but never overwrite fields once the user has edited them.
  useEffect(() => {
    touchedRef.current = false;
    setNotice("");
    let cancelled = false;
    let timer = 0;
    const startedAt = Date.now();
    const attempt = () => {
      if (cancelled || touchedRef.current) return;
      const extracted = extractUpworkProposalDetails();
      setDetails(extracted);
      if (extracted.baseConnects != null || extracted.contractType !== "") return;
      if (Date.now() - startedAt >= 5_000) return;
      timer = window.setTimeout(attempt, 500);
    };
    attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [url]);

  const totalConnects = (details.baseConnects ?? 0) + (details.boostCharged ?? details.boostBid ?? 0);

  const trackProposal = async () => {
    setBusy(true);
    setNotice("");
    try {
      const application: Application = { ...buildCurrentApplication("Applied"), upwork: details };
      const response = await chrome.runtime.sendMessage({ kind: "LOG_APPLICATION", application } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Tracking failed.");
      if (demoMode) {
        setNotice("Demo mode: not saved.");
      } else {
        onTracked(application);
        setNotice("Proposal saved to tracker.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: UpworkProposalStatus) => {
    if (!tracked?.id) return;
    setNotice("");
    try {
      const patch = changeUpworkStatus(tracked, status);
      const response = await chrome.runtime.sendMessage({ kind: "UPDATE_APPLICATION", id: tracked.id, patch } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Status update failed.");
      onPatched(patch);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="jtMatch">
      <p className="jtChipHeading">Proposal details</p>
      <p className="jtMuted">Contract: {details.contractType || "unknown"}</p>
      <NumberField label="Bid" value={details.proposedAmount} onChange={(value) => editDetails({ ...details, proposedAmount: value })} />
      <NumberField label="Base Connects" value={details.baseConnects} onChange={(value) => editDetails({ ...details, baseConnects: value })} />
      <NumberField label="Boost bid" value={details.boostBid} onChange={(value) => editDetails({ ...details, boostBid: value })} />
      <NumberField label="Boost charged" value={details.boostCharged} onChange={(value) => editDetails({ ...details, boostCharged: value })} />
      <p className="jtMuted">Total Connects: {totalConnects}</p>
      {tracked?.upwork && tracked.id ? (
        <label className="jtField">
          <span>Proposal status</span>
          <select
            value={tracked.upwork.status}
            onChange={(event) => void changeStatus(event.target.value as UpworkProposalStatus)}
          >
            {UPWORK_PROPOSAL_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
      ) : (
        <button className="jtButton" onClick={() => void trackProposal()} disabled={busy}>
          {busy ? "Saving..." : "Track proposal"}
        </button>
      )}
      {notice && <p className="jtNotice">{notice}</p>}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (value: number | null) => void }) {
  return (
    <label className="jtField">
      <span>{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      />
    </label>
  );
}

function TrackConfirm({
  pending,
  demoMode,
  defaultMode,
  onDone
}: {
  pending: PendingApplication;
  demoMode: boolean;
  defaultMode: TrackingEntryMode;
  onDone: (application: Application | undefined, notice: string) => void;
}) {
  const [mode, setMode] = useState<TrackingEntryMode>(defaultMode);
  const [postingText, setPostingText] = useState("");
  const [draft, setDraft] = useState<Application | undefined>(() => defaultMode === "manual" ? emptyTrackingApplication() : undefined);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const readPosting = async () => {
    setReading(true);
    setError("");
    try {
      const response = await chrome.runtime.sendMessage({
        kind: "AI_DRAFT_APPLICATION",
        postingText
      } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "AI could not read the job text.");
      const result = response.draft as JobPostingDraft;
      setDraft({
        company: result.company,
        role: result.role,
        jobUrl: result.jobUrl,
        source: result.source,
        dateApplied: new Date().toISOString(),
        status: "Applied",
        location: result.location,
        workMode: result.workMode,
        compensation: result.compensation,
        jobDescription: result.jobDescription,
        answersUsed: [],
        notes: "",
        upwork: result.upwork
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setReading(false);
    }
  };

  const confirm = async () => {
    if (!draft) return;
    if (!draft.company.trim() || !draft.role.trim()) {
      setError("Company and role are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const application: Application = { ...draft, status: "Applied" };
      const logResponse = await chrome.runtime.sendMessage({ kind: "LOG_APPLICATION", application } satisfies ExtensionMessage);
      if (!logResponse?.ok) throw new Error(logResponse?.error ?? "Tracking failed.");
      await chrome.runtime.sendMessage({ kind: "REMOVE_PENDING_APPLICATION", id: pending.id } satisfies ExtensionMessage);
      onDone(demoMode ? undefined : application, demoMode ? "Demo mode: not saved." : "Saved to tracker.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSaving(false);
    }
  };

  const dismiss = async () => {
    await chrome.runtime.sendMessage({ kind: "REMOVE_PENDING_APPLICATION", id: pending.id } satisfies ExtensionMessage);
    onDone(undefined, "");
  };

  const changeMode = (nextMode: TrackingEntryMode) => {
    setMode(nextMode);
    setPostingText("");
    setDraft(nextMode === "manual" ? emptyTrackingApplication() : undefined);
    setError("");
  };

  return (
    <div className="jtMatch">
      <p className="jtChipHeading">Application detected</p>
      <TrackingModeSwitch mode={mode} onChange={changeMode} />
      {mode === "ai" && !draft ? (
        <>
          <label className="jtField">
            <span>Paste job details for AI</span>
            <textarea
              className="jtTextarea"
              rows={7}
              value={postingText}
              onChange={(event) => setPostingText(event.target.value)}
              placeholder="Paste the job post or the details you want saved."
              autoFocus
            />
          </label>
          <p className="jtMuted">Only your pasted text is used. Detected page data is not added to the tracker.</p>
        </>
      ) : draft ? (
        <TrackDraftForm draft={draft} mode={mode} onChange={setDraft} />
      ) : null}
      {error && <p className="jtError">{error}</p>}
      <div className="jtFooter">
        <button
          className="jtButton"
          onClick={() => void (draft ? confirm() : readPosting())}
          disabled={saving || reading || (!draft && !postingText.trim())}
        >
          {saving ? "Saving..." : reading ? "Reading with AI..." : draft ? "Save as applied" : "Fill tracker with AI"}
        </button>
        {mode === "ai" && draft && (
          <button className="jtButtonGhost" onClick={() => setDraft(undefined)} disabled={saving}>
            Back
          </button>
        )}
        <button className="jtButtonGhost" onClick={() => void dismiss()} disabled={saving || reading}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
