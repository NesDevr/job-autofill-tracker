import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BriefcaseBusiness, ExternalLink, LayoutDashboard, PanelRightOpen, Pencil, Plus, RotateCcw, Trash2, Wand2, X } from "lucide-react";
import { getSettings, saveSettings } from "../../lib/storage";
import { SAVED_SEARCHES } from "../../lib/savedSearches";
import type { AutofillReviewItem, AutofillReviewStatus, ExtensionMessage, SavedSearch, Settings } from "../../lib/schema";
import "./styles.css";

const REVIEW_LABELS: Record<AutofillReviewStatus, string> = {
  filled: "Filled",
  missing: "Missing",
  unsupported: "Blocked",
  confirmation: "Confirm"
};

function Popup() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [review, setReview] = useState<AutofillReviewItem[]>([]);
  const [customSearches, setCustomSearches] = useState<SavedSearch[]>([]);
  const [hiddenPresets, setHiddenPresets] = useState<string[]>([]);

  useEffect(() => {
    void getSettings().then((loaded) => {
      document.documentElement.dataset.theme = loaded.theme;
      setCustomSearches(loaded.customSearches);
      setHiddenPresets(loaded.hiddenPresetSearches);
    });
  }, []);

  async function persistSearches(next: { customSearches?: SavedSearch[]; hiddenPresets?: string[] }) {
    if (next.customSearches) setCustomSearches(next.customSearches);
    if (next.hiddenPresets) setHiddenPresets(next.hiddenPresets);
    const settings = await getSettings();
    await saveSettings({
      ...settings,
      customSearches: next.customSearches ?? settings.customSearches,
      hiddenPresetSearches: next.hiddenPresets ?? settings.hiddenPresetSearches
    } satisfies Settings);
  }

  async function autofill() {
    setBusy(true);
    setStatus("");
    setReview([]);
    try {
      const response = await chrome.runtime.sendMessage({ kind: "AUTOFILL_ACTIVE_TAB" } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Autofill failed.");
      const outstanding = ((response.review as AutofillReviewItem[] | undefined) ?? []).filter((item) => item.status !== "filled");
      setReview(outstanding);
      setStatus(`${response.filled ?? 0} filled${outstanding.length ? ` · ${outstanding.length} to review` : ""}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function openDashboard() {
    setStatus("");
    const response = await chrome.runtime.sendMessage({ kind: "OPEN_DASHBOARD" } satisfies ExtensionMessage);
    if (!response?.ok) {
      setStatus(response?.error ?? "Opening the dashboard failed.");
      return;
    }
    window.close();
  }

  async function openSidebar() {
    setBusy(true);
    setStatus("");
    try {
      const response = await chrome.runtime.sendMessage({ kind: "OPEN_WIDGET_ACTIVE_TAB" } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Opening the sidebar failed.");
      window.close();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <span className="mark"><BriefcaseBusiness size={15} /></span>
        <div>
          <p>JOB OPS</p>
          <h1>Autofill desk</h1>
        </div>
      </header>
      <div className="actions">
        <button onClick={() => void openDashboard()} disabled={busy}>
          <LayoutDashboard size={17} />
          <span><strong>Tracking dashboard</strong><small>Review applications and follow-ups</small></span>
        </button>
        <button onClick={() => void autofill()} disabled={busy}>
          <Wand2 size={17} />
          <span><strong>{busy ? "Autofilling..." : "Autofill current page"}</strong><small>Fill detected application fields</small></span>
        </button>
        <button onClick={() => void openSidebar()} disabled={busy}>
          <PanelRightOpen size={17} />
          <span><strong>Open sidebar</strong><small>Use tracker, answers, and profile tools</small></span>
        </button>
      </div>
      <SavedSearches customSearches={customSearches} hiddenPresets={hiddenPresets} onChange={persistSearches} />
      {status && <p className="status" role="status">{status}</p>}
      {review.length > 0 && (
        <ul className="review">
          {review.map((item) => (
            <li className={`reviewItem review-${item.status}`} key={`${item.id}-${item.question}`}>
              <span>{REVIEW_LABELS[item.status]}</span>
              <div>
                <strong>{item.question}</strong>
                <p>{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function SavedSearches({
  customSearches,
  hiddenPresets,
  onChange
}: {
  customSearches: SavedSearch[];
  hiddenPresets: string[];
  onChange: (searches: { customSearches?: SavedSearch[]; hiddenPresets?: string[] }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  function openSearch(search: SavedSearch) {
    void chrome.tabs.update({ url: search.url });
    window.close();
  }

  async function addSearch() {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    const search: SavedSearch = {
      id: crypto.randomUUID(),
      label: label.trim() || trimmedUrl,
      url: trimmedUrl
    };
    await onChange({ customSearches: [...customSearches, search] });
    setLabel("");
    setUrl("");
  }

  async function removeCustom(id: string) {
    await onChange({ customSearches: customSearches.filter((search) => search.id !== id) });
  }

  async function hidePreset(id: string) {
    if (hiddenPresets.includes(id)) return;
    await onChange({ hiddenPresets: [...hiddenPresets, id] });
  }

  async function restorePreset(id: string) {
    await onChange({ hiddenPresets: hiddenPresets.filter((hidden) => hidden !== id) });
  }

  // In edit mode every preset is listed so hidden ones can be restored; otherwise
  // hidden presets are dropped entirely.
  const presets = editing ? SAVED_SEARCHES : SAVED_SEARCHES.filter((search) => !hiddenPresets.includes(search.id));

  return (
    <section className="searches">
      <div className="searchesHeader">
        <p>SAVED SEARCHES</p>
        <button className="searchesEdit" type="button" onClick={() => setEditing(!editing)}>
          {editing ? <><X size={12} /> Done</> : <><Pencil size={12} /> Edit</>}
        </button>
      </div>
      <div className="searchLinks">
        {presets.map((search) => {
          const hidden = hiddenPresets.includes(search.id);
          return (
            <div className={hidden ? "searchRow hidden" : "searchRow"} key={search.id}>
              <button className="searchLink" type="button" disabled={hidden} onClick={() => openSearch(search)} title={search.url}>
                <ExternalLink size={13} />
                <span>{search.label}</span>
              </button>
              {editing && (
                hidden ? (
                  <button className="searchDelete restore" type="button" title="Restore" aria-label="Restore search" onClick={() => void restorePreset(search.id)}>
                    <RotateCcw size={13} />
                  </button>
                ) : (
                  <button className="searchDelete" type="button" title="Hide" aria-label="Hide search" onClick={() => void hidePreset(search.id)}>
                    <Trash2 size={13} />
                  </button>
                )
              )}
            </div>
          );
        })}
        {customSearches.map((search) => (
          <div className="searchRow" key={search.id}>
            <button className="searchLink" type="button" onClick={() => openSearch(search)} title={search.url}>
              <ExternalLink size={13} />
              <span>{search.label}</span>
            </button>
            {editing && (
              <button className="searchDelete" type="button" title="Remove" aria-label="Remove search" onClick={() => void removeCustom(search.id)}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <div className="searchForm">
          <input placeholder="Label (e.g. Upwork · Django)" value={label} onChange={(event) => setLabel(event.target.value)} />
          <input placeholder="https://..." value={url} onChange={(event) => setUrl(event.target.value)} />
          <button type="button" onClick={() => void addSearch()} disabled={!url.trim()}>
            <Plus size={13} /> Add link
          </button>
        </div>
      )}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
