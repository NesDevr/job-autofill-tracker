import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BriefcaseBusiness, LayoutDashboard, PanelRightOpen, Wand2 } from "lucide-react";
import { getSettings } from "../../lib/storage";
import type { AutofillReviewItem, ExtensionMessage } from "../../lib/schema";
import "./styles.css";

function Popup() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void getSettings().then((settings) => {
      document.documentElement.dataset.theme = settings.theme;
    });
  }, []);

  async function autofill() {
    setBusy(true);
    setStatus("");
    try {
      const response = await chrome.runtime.sendMessage({ kind: "AUTOFILL_ACTIVE_TAB" } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Autofill failed.");
      const review = (response.review as AutofillReviewItem[] | undefined) ?? [];
      const outstanding = review.filter((item) => item.status !== "filled").length;
      setStatus(`${response.filled ?? 0} filled${outstanding ? ` · ${outstanding} to review` : ""}.`);
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
        <button className="primary" onClick={() => void autofill()} disabled={busy}>
          <Wand2 size={17} />
          <span><strong>{busy ? "Autofilling..." : "Autofill current page"}</strong><small>Fill detected application fields</small></span>
        </button>
        <button onClick={() => void openSidebar()} disabled={busy}>
          <PanelRightOpen size={17} />
          <span><strong>Open sidebar</strong><small>Use tracker, answers, and profile tools</small></span>
        </button>
        <button onClick={() => void openDashboard()} disabled={busy}>
          <LayoutDashboard size={17} />
          <span><strong>Tracking dashboard</strong><small>Review applications and follow-ups</small></span>
        </button>
      </div>
      {status && <p className="status" role="status">{status}</p>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
