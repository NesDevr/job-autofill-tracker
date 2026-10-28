import { getSettings } from "./storage";

const SCRIPT_ID = "linkedin-probe-blocker";
let pendingSync: Promise<void> = Promise.resolve();

export function syncLinkedInProbeProtection(): Promise<void> {
  // Serialize startup and settings changes so rapid toggles cannot race.
  pendingSync = pendingSync.catch(() => {}).then(async () => {
    const { blockLinkedInExtensionProbes } = await getSettings();
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (!blockLinkedInExtensionProbes) {
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      return;
    }
    const script: chrome.scripting.RegisteredContentScript = {
      id: SCRIPT_ID,
      matches: ["https://*.linkedin.com/*"],
      js: ["linkedin-probe-blocker.js"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
      matchOriginAsFallback: true,
      persistAcrossSessions: true
    };
    if (registered.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  });
  return pendingSync;
}
