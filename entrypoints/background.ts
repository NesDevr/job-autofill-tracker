import { draftAnswers } from "../lib/ai";
import { db } from "../lib/db";
import { deterministicValue, memoryValue } from "../lib/mapping";
import { getProfile, getSettings, queuePendingApplication, removePendingApplication, setDashboardLaunch } from "../lib/storage";
import type { ExtensionMessage, FieldFill } from "../lib/schema";

export default defineBackground({
  main() {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

    chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
      handleMessage(message)
        .then(sendResponse)
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          sendResponse({ ok: false, error: detail });
        });
      return true;
    });
  }
});

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  if (message.kind === "LOG_APPLICATION") {
    await db.applications.add(message.application);
    return { ok: true };
  }

  if (message.kind === "QUEUE_PENDING_APPLICATION") {
    await queuePendingApplication(message.pending);
    return { ok: true };
  }

  if (message.kind === "REMOVE_PENDING_APPLICATION") {
    await removePendingApplication(message.id);
    return { ok: true };
  }

  if (message.kind === "OPEN_TRACKER_PASTE") {
    await queuePendingApplication(message.pending);
    await setDashboardLaunch({ tab: "tracker", pendingId: message.pending.id, createdAt: new Date().toISOString() });
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }

  if (message.kind === "AUTOFILL_CURRENT_FORM") {
    return { ok: false, error: "Autofill must be sent to a page tab." };
  }

  if (message.kind === "TRACK_CURRENT_APPLICATION") {
    return { ok: false, error: "Tracking must be sent to a page tab." };
  }

  const profile = await getProfile();
  const settings = await getSettings();
  const fills: FieldFill[] = [];
  const remaining = [];

  for (const field of message.fields) {
    const deterministic = deterministicValue(field, profile);
    if (deterministic) {
      fills.push(deterministic);
      continue;
    }

    const memory = await memoryValue(field);
    if (memory) {
      fills.push(memory);
      continue;
    }

    if (field.type === "textarea" || field.question.length > 40) {
      remaining.push(field);
    }
  }

  fills.push(...(await draftAnswers(remaining, profile, settings, message.jobDescription)));
  return { ok: true, fills };
}
