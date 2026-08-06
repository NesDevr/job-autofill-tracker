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
    const allowedJobPage = isAllowedJobPage();
    const canAutofillHere = allowedJobPage && !isTopPageWithEmbeddedJobForm();

    chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
      if (message.kind === "AUTOFILL_CURRENT_FORM") {
        // Some ATSs render their application form after document_idle. Check
        // again at the user action instead of relying on the page-load state.
        const canAutofillNow = isAllowedJobPage() && !isTopPageWithEmbeddedJobForm();
        if (canAutofillNow) {
          fillCurrentForm()
            .then(sendResponse)
            .catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error);
              sendResponse({ ok: false, error: detail });
            });
          return true;
        }

        // Do not reply from an iframe host: its application-frame listener must
        // be the one that answers the message.
        if (window.self === window.top && !isTopPageWithEmbeddedJobForm()) {
          sendResponse({
            ok: false,
            error: "No application form was detected on this page. Open the application form, then try autofill again."
          });
          return false;
        }
      }

      if (message.kind === "TRACK_CURRENT_APPLICATION" && isAllowedJobPage() && !isTopPageWithEmbeddedJobForm()) {
        sendResponse({ ok: true, pending: queueTrackCurrentApplication() });
        return false;
      }
      return false;
    });

    // Autofill/submit engine runs in every frame except a top page that only hosts an ATS iframe.
    if (canAutofillHere) {
      watchSubmit();
    }

    // Mount once per tab. Unsupported sites keep the launcher hidden, but the
    // extension popup can still open the drawer explicitly.
    if (window.self !== window.top) return;

    const ui = await createShadowRootUi(ctx, {
      name: "jobtracker-widget",
      position: "overlay",
      anchor: "body",
      onMount(container) {
        const root = createRoot(container);
        root.render(
          <ErrorBoundary>
            <Widget showFab={allowedJobPage} />
          </ErrorBoundary>
        );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      }
    });
    ui.mount();

    if (allowedJobPage && (await getSettings()).cardBadges) {
      initCardBadges(await getProfile());
    }
  }
});
