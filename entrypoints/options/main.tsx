import React from "react";
import { createRoot } from "react-dom/client";
import "../sidepanel/styles.css";

function Options() {
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Job Autofill + Tracker</p>
          <h1>Settings live in the side panel</h1>
        </div>
      </header>
      <section className="panel">
        <div className="empty">
          <strong>Open the extension from the toolbar.</strong>
          <p>The side panel keeps profile, tracker, answer memory, API key, CSV export, and follow-up reminders in one place.</p>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Options />);
