import { createRoot } from "react-dom/client";
import type { ExtensionMessage } from "../../lib/schema";
import {
  fillCurrentForm,
  isAllowedJobPage,
  isTopPageWithEmbeddedJobForm,
  queueTrackCurrentApplication,
  watchSubmit
} from "./engine";
import { getProfile, getSettings } from "../../lib/storage";
import { initCardBadges } from "./cardBadges";
import ErrorBoundary from "./ErrorBoundary";
import Widget from "./Widget";
import "./widget.css";

export default defineContentScript({
  // Runs everywhere; isAllowedJobPage() gates activation to known job sites
  // plus any page that looks like an application form (hasApplicationSurface).
  matches: ["https://*/*", "http://*/*"],
  allFrames: true,
  runAt: "document_idle",
  cssInjectionMode: "ui",
  async main(ctx) {
    if (!isAllowedJobPage()) return;

    // Autofill/submit engine runs in every frame except a top page that only hosts an ATS iframe.
    if (!isTopPageWithEmbeddedJobForm()) {
      chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
        if (message.kind === "AUTOFILL_CURRENT_FORM") {
          fillCurrentForm(message.autofillContext)
            .then(sendResponse)
            .catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error);
              sendResponse({ ok: false, error: detail });
            });
          return true;
        }

        if (message.kind === "TRACK_CURRENT_APPLICATION") {
          sendResponse({ ok: true, pending: queueTrackCurrentApplication() });
          return false;
        }

        return false;
      });
      watchSubmit();
    }

    // The embedded widget mounts exactly once per tab, in the top frame.
    if (window.self !== window.top) return;

    const ui = await createShadowRootUi(ctx, {
      name: "jobtracker-widget",
      position: "overlay",
      anchor: "body",
      onMount(container) {
        const root = createRoot(container);
        root.render(
          <ErrorBoundary>
            <Widget />
          </ErrorBoundary>
        );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      }
    });
    ui.mount();

    if ((await getSettings()).cardBadges) {
      initCardBadges(await getProfile());
    }
  }
});
