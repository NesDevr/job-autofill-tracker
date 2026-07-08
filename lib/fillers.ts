import type { FieldFill } from "./schema";

export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) throw new Error("Native value setter is unavailable.");
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

export function applyFill(field: HTMLElement, fill: FieldFill): void {
  if (field instanceof HTMLTextAreaElement) {
    setNativeValue(field, String(fill.value));
    return;
  }

  if (field instanceof HTMLSelectElement) {
    const option = Array.from(field.options).find((candidate) => candidate.text === String(fill.value));
    field.value = option?.value ?? String(fill.value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (field instanceof HTMLInputElement) {
    if (field.type === "checkbox" || field.type === "radio") {
      field.checked = Boolean(fill.value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    if (field.type === "file") return;
    setNativeValue(field, String(fill.value));
  }
}
