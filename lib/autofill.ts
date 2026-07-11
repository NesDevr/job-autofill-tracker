export type AutofillResult = {
  ok: boolean;
  filled?: number;
  resumeOpened?: boolean;
  error?: string;
};

export async function sendAutofillMessage(tabId: number): Promise<AutofillResult> {
  try {
    return await chrome.tabs.sendMessage(tabId, { kind: "AUTOFILL_CURRENT_FORM" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (!detail.includes("Receiving end does not exist")) throw error;
  }

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content-scripts/content.js"]
  });
  await wait(150);
  return await chrome.tabs.sendMessage(tabId, { kind: "AUTOFILL_CURRENT_FORM" });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
