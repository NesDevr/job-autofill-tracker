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
  if (isHyperlinkTrigger(target)) return verified(false, "Add this hyperlink manually.");

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
