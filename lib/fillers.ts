import type { FieldFill } from "./schema";

export type FillTarget = HTMLElement | HTMLElement[];

export type ApplyFillResult = {
  ok: boolean;
  detail: string;
};

export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) throw new Error("Native value setter is unavailable.");
  setter.call(el, value);
  dispatchInputEvents(el);
}

export async function applyFill(target: FillTarget, fill: FieldFill): Promise<ApplyFillResult> {
  if (Array.isArray(target)) return verified(false, "Choose this radio option manually.");
  if (isHyperlinkTrigger(target)) return fillHyperlink(target, String(fill.value));

  if (target instanceof HTMLTextAreaElement) {
    setNativeValue(target, String(fill.value));
    return verified(textMatches(target.value, fill.value), "Text area did not retain the value.");
  }

  if (target instanceof HTMLSelectElement) {
    const option = matchingOption(Array.from(target.options), fill.value);
    if (!option) return verified(false, `Option “${String(fill.value)}” is unavailable.`);
    target.value = option.value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return verified(target.value === option.value, "Select did not retain the option.");
  }

  if (!(target instanceof HTMLInputElement)) return verified(false, "Unsupported page control.");

  if (target.getAttribute("role") === "combobox") return verified(false, "Choose this dropdown option manually.");

  if (target.type === "checkbox") {
    if (typeof fill.value !== "boolean") return verified(false, "Checkbox requires an explicit true or false preference.");
    target.checked = fill.value;
    dispatchInputEvents(target);
    return verified(target.checked === fill.value, "Checkbox did not retain its state.");
  }

  if (target.type === "file" || target.type === "password") return verified(false, "This control requires direct user action.");

  setNativeValue(target, String(fill.value));
  return verified(textMatches(target.value, fill.value), "Input did not retain the value.");
}

async function fillHyperlink(trigger: HTMLElement, value: string): Promise<ApplyFillResult> {
  trigger.click();
  const dialog = await waitForElement(() => Array.from(document.querySelectorAll<HTMLElement>("[role=dialog], .modal, .modalWindow")).find(isVisible));
  if (!dialog) return verified(false, "Hyperlink editor did not open.");
  const inputs = Array.from(dialog.querySelectorAll<HTMLInputElement>("input[type=url], input[type=text]")).filter(isVisible);
  const urlInput = inputs.find((input) => /url/i.test(`${input.name} ${input.getAttribute("aria-label") || ""}`));
  if (!urlInput) return verified(false, "Hyperlink editor has no visible URL field.");
  const friendlyName = inputs.find((input) => /friendly name/i.test(input.getAttribute("aria-label") || ""));
  if (friendlyName && !friendlyName.value) setNativeValue(friendlyName, /linkedin/i.test(trigger.textContent || "") ? "LinkedIn" : "Profile link");
  setNativeValue(urlInput, value);
  await nextTask();
  const save = Array.from(dialog.querySelectorAll<HTMLElement>("button, [role=button], input[type=button]")).find((item) =>
    /^(add|save|ok|done)$/i.test((item.innerText || item.getAttribute("value") || "").trim())
  );
  if (!save) return verified(false, "Hyperlink editor has no recognizable save action.");
  if (save instanceof HTMLButtonElement && save.disabled) return verified(false, "Hyperlink editor did not accept the URL.");
  save.click();
  await nextTask();
  return verified(true, "");
}

function matchingOption(options: HTMLOptionElement[], value: string | boolean): HTMLOptionElement | undefined {
  const desired = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  return options.find((option) => normalized(option.text) === normalized(desired))
    ?? options.find((option) => normalized(option.text).includes(normalized(desired)));
}

function isHyperlinkTrigger(target: HTMLElement): boolean {
  return target.getAttribute("role") === "button" && /hyperlink|linkedin/i.test(`${target.id} ${target.innerText} ${target.textContent}`);
}

function dispatchInputEvents(target: HTMLElement): void {
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  target.dispatchEvent(new Event("blur", { bubbles: true }));
}

function textMatches(actual: string, expected: string | boolean): boolean {
  const desired = typeof expected === "boolean" ? (expected ? "yes" : "no") : String(expected);
  return normalized(actual) === normalized(desired);
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function verified(ok: boolean, detail: string): ApplyFillResult {
  return { ok, detail: ok ? "" : detail };
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

async function waitForElement<T>(read: () => T | undefined | null): Promise<T | undefined> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return undefined;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}
