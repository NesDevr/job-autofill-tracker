import { applyFill, type FillTarget } from "../lib/fillers";
import { formatProfileNationalPhone, formatProfilePhone } from "../lib/profileValues";
import { getProfile } from "../lib/storage";
import type { Application, AutofillReviewItem, ExtensionMessage, FieldDescriptor, FieldFill, PageContext, PendingApplication, Profile } from "../lib/schema";

const fieldRefs = new Map<string, FillTarget>();
const loggedSubmissionKeys = new Set<string>();

export default defineContentScript({
  matches: [
    "https://*.greenhouse.io/*",
    "https://*.lever.co/*",
    "https://*.ashbyhq.com/*",
    "https://*.linkedin.com/jobs/*",
    "https://*.indeed.com/*",
    "https://*.comeet.co/*"
  ],
  allFrames: true,
  runAt: "document_idle",
  main() {
    if (!isAllowedJobPage()) return;
    if (isTopPageWithEmbeddedJobForm()) return;
    chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
      if (message.kind === "AUTOFILL_CURRENT_FORM") {
        fillCurrentForm()
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
});

function isAllowedJobPage(): boolean {
  const host = location.hostname.toLowerCase();
  const path = location.pathname.toLowerCase();
  if (host.includes("hcaptcha.com")) return false;
  return (
    host.endsWith("greenhouse.io") ||
    host.endsWith("lever.co") ||
    host.includes("ashbyhq.com") ||
    host.includes("comeet.co") ||
    (host.endsWith("linkedin.com") && path.includes("/jobs")) ||
    (host.endsWith("indeed.com") && /job|viewjob|apply/.test(path)) ||
    hasApplicationSurface()
  );
}

function hasApplicationSurface(): boolean {
  const text = normalizeSignal(document.body?.innerText ?? "");
  if (!hasAny(text, ["application", "resume", "upload your resume", "submit application"])) return false;
  return Array.from(document.querySelectorAll<HTMLElement>("input,textarea,select,button")).some(isVisible);
}

function isTopPageWithEmbeddedJobForm(): boolean {
  if (window.self !== window.top) return false;
  return Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe")).some((iframe) =>
    isJobFrameUrl(iframe.src)
  );
}

function isJobFrameUrl(src: string): boolean {
  try {
    const url = new URL(src);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    return (
      host.includes("comeet.co") ||
      host.includes("greenhouse.io") ||
      host.includes("lever.co") ||
      host.includes("ashbyhq.com") ||
      (host.includes("linkedin.com") && path.includes("/jobs"))
    );
  } catch {
    return false;
  }
}

async function fillCurrentForm(): Promise<{ ok: true; filled: number; resumeOpened: boolean; review: AutofillReviewItem[] }> {
  const profile = await getProfile();
  const review = new Map<string, AutofillReviewItem>();
  const firstFields = extractFields();
  await fillPass(firstFields, profile, review);

  await wait(200);
  const initialQuestions = new Set(firstFields.map((field) => field.question));
  const secondFields = extractFields();
  const revealedFields = secondFields.filter((field) => !initialQuestions.has(field.question));
  if (revealedFields.length > 0) await fillPass(revealedFields, profile, review);

  for (const field of extractFields()) {
    if (review.has(fieldKey(field))) continue;
    const target = fieldRefs.get(field.id);
    if (isLegalConfirmation(field)) {
      review.set(fieldKey(field), reviewItem(field, "confirmation", "Review and confirm this declaration on the page."));
    } else if (target && isPageSpecificChoice(field, target)) {
      review.set(fieldKey(field), reviewItem(field, "confirmation", "Choose this option manually on the page."));
    } else if (target && targetHasValue(target)) {
      review.set(fieldKey(field), reviewItem(field, "filled", "Already complete."));
    }
  }

  const attachment = await attachStoredResume(profile);
  if (attachment.review) review.set(attachment.review.question, attachment.review);
  const coverLetter = await attachStoredCoverLetter(profile);
  if (coverLetter.review) review.set(coverLetter.review.question, coverLetter.review);
  const items = Array.from(review.values());
  return {
    ok: true,
    filled: items.filter((item) => item.status === "filled").length,
    resumeOpened: attachment.opened,
    review: items
  };
}

async function fillPass(fields: FieldDescriptor[], profile: Profile, review: Map<string, AutofillReviewItem>): Promise<void> {
  const fieldsToMap = fields.filter((field) => {
    const target = fieldRefs.get(field.id);
    if (!target) return false;
    if (isLegalConfirmation(field)) {
      review.set(fieldKey(field), reviewItem(field, "confirmation", "Review and confirm this declaration on the page."));
      return false;
    }
    if (isPageSpecificChoice(field, target)) {
      review.set(fieldKey(field), reviewItem(field, "confirmation", "Choose this option manually on the page."));
      return false;
    }
    if (targetHasValue(target)) {
      review.set(fieldKey(field), reviewItem(field, "filled", "Already complete."));
      return false;
    }
    if (shouldSkipDependentField(field, profile)) return false;
    return true;
  });

  const localFills = fieldsToMap.map((field) => directProfileFill(field, profile)).filter(Boolean) as FieldFill[];
  const request: ExtensionMessage = {
    kind: "MAP_FIELDS",
    fields: fieldsToMap,
    jobDescription: extractJobDescription(),
    page: getPageContext()
  };
  const response = await chrome.runtime.sendMessage(request);
  if (!response?.ok) throw new Error(response?.error ?? "Mapping failed.");

  const fills = mergeFills(localFills, response.fills as FieldFill[]);
  const fillsById = new Map(fills.map((fill) => [fill.id, fill]));

  for (const field of fieldsToMap) {
    const target = fieldRefs.get(field.id);
    const fill = fillsById.get(field.id);
    if (!target) continue;
    if (!fill) {
      review.set(fieldKey(field), reviewItem(field, "missing", "Add this answer to the master profile."));
      continue;
    }
    const result = await applyFill(target, fill);
    review.set(fieldKey(field), reviewItem(field, result.ok ? "filled" : "unsupported", result.ok ? "Filled and verified." : result.detail));
  }
}

function isPageSpecificChoice(field: FieldDescriptor, target: FillTarget): boolean {
  return field.type === "combobox" || Array.isArray(target);
}

function reviewItem(field: FieldDescriptor, status: AutofillReviewItem["status"], detail: string): AutofillReviewItem {
  return { id: field.id, question: field.question, status, detail };
}

function fieldKey(field: FieldDescriptor): string {
  return `${field.id}|${field.question}`;
}

function shouldSkipDependentField(field: FieldDescriptor, profile: Profile): boolean {
  const question = normalizeSignal(field.question);
  if (hasAny(question, ["if yes what is your visa", "visa status"])) return !profile.workAuthorization.requiresSponsorship;
  if (hasAny(question, ["if yes please specify", "adjustment details"])) return !profile.applicationDefaults.needsRecruitmentAdjustments;
  if (hasAny(question, ["if other please provide details"])) return !profile.applicationDefaults.referralDetails;
  if (hasAny(question, ["employee referral provide name"])) return !profile.applicationDefaults.employeeReferralName;
  return false;
}

function targetHasValue(target: FillTarget): boolean {
  if (Array.isArray(target)) return false;
  if (target instanceof HTMLSelectElement) return Boolean(target.value) && target.selectedIndex > 0;
  if (target instanceof HTMLInputElement) {
    if (target.type === "checkbox" || target.type === "radio") return false;
    if (target.getAttribute("role") === "combobox") return Boolean(target.value.trim());
    return Boolean(target.value.trim());
  }
  if (target instanceof HTMLTextAreaElement) return Boolean(target.value.trim());
  if (isSuccessFactorsHyperlinkTrigger(target)) {
    const hidden = target.parentElement?.querySelector<HTMLInputElement>("input[type=hidden]");
    return Boolean(hidden?.value.trim());
  }
  return false;
}

function extractFields(): FieldDescriptor[] {
  fieldRefs.clear();
  const excludedTypes = new Set(["hidden", "password", "button", "submit", "reset", "image"]);
  const elements = Array.from(document.querySelectorAll<HTMLElement>("input, textarea, select"))
    .filter((element) => isVisible(element) && !isSearchOrNav(element))
    .filter((element) => !(element instanceof HTMLInputElement) || !excludedTypes.has(element.type));
  const fields: FieldDescriptor[] = [];
  const seenRadioNames = new Set<string>();

  for (const element of elements) {
    if (element instanceof HTMLInputElement && element.type === "radio" && element.name) {
      if (seenRadioNames.has(element.name)) continue;
      seenRadioNames.add(element.name);
      const radios = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(element.name)}"]`)).filter(isVisible);
      const id = `field-${fields.length}`;
      fieldRefs.set(id, radios);
      fields.push({
        id,
        question: radioGroupQuestion(element),
        type: "radio",
        options: radios.map(radioLabel).filter(Boolean),
        value: radios.find((radio) => radio.checked) ? radioLabel(radios.find((radio) => radio.checked)!) : "",
        required: radios.some((radio) => radio.required || radio.getAttribute("aria-required") === "true")
      });
      continue;
    }

    const id = `field-${fields.length}`;
    fieldRefs.set(id, element);
    fields.push({
      id,
      question: describeField(element),
      type: fieldType(element),
      options: optionsOf(element),
      value: fieldValue(element),
      required: isRequired(element)
    });
  }

  for (const trigger of Array.from(document.querySelectorAll<HTMLElement>("[role=button].rcmHyperlinkIconAdd"))) {
    if (!isVisible(trigger)) continue;
    const hidden = trigger.parentElement?.querySelector<HTMLInputElement>("input[type=hidden]");
    if (!hidden) continue;
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(hidden.id)}"]`);
    const id = `field-${fields.length}`;
    fieldRefs.set(id, trigger);
    fields.push({ id, question: cleanLabel(label?.innerText || hidden.name || "Hyperlink"), type: "hyperlink", value: hidden.value, required: false });
  }

  for (const button of Array.from(document.querySelectorAll<HTMLElement>("button, [role=button]"))) {
    const text = cleanLabel(`${button.getAttribute("aria-label") || ""} ${button.innerText || button.textContent || ""}`);
    if (!isVisible(button) || !/terms of use|privacy statement/i.test(text)) continue;
    const id = `field-${fields.length}`;
    fieldRefs.set(id, button);
    fields.push({ id, question: text, type: "confirmation", value: false, required: true });
  }

  return fields.filter((field) => field.question.length > 0);
}

function describeField(element: HTMLElement): string {
  const primary = cleanLabel(labelFor(element) || element.getAttribute("aria-label") || ariaLabelledByText(element));
  if (primary) return primary;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const placeholder = cleanLabel(element.placeholder);
    if (placeholder && !/no selection/i.test(placeholder)) return placeholder;
  }
  return cleanLabel(nearestText(element) || element.getAttribute("name") || element.id);
}

function cleanLabel(value: string): string {
  return value.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim();
}

function labelFor(el: HTMLElement): string {
  if (el.id) {
    const direct = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`);
    if (direct?.innerText) return direct.innerText;
  }
  return el.closest("label")?.textContent?.trim() ?? "";
}

function ariaLabelledByText(el: HTMLElement): string {
  const ids = el.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
  return ids.map((id) => document.getElementById(id)?.innerText ?? "").join(" ");
}

function nearestText(el: HTMLElement): string {
  const parent = el.closest("fieldset, [data-qa], .field, .application-question, tr, td") as HTMLElement | null;
  if (!parent) return "";
  const text = parent.innerText.replace(el instanceof HTMLInputElement ? el.value : "", "").trim();
  return text.length <= 180 ? text : "";
}

function fieldType(el: HTMLElement): FieldDescriptor["type"] {
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLInputElement) {
    if (el.getAttribute("role") === "combobox") return "combobox";
    if (el.type === "checkbox") return "checkbox";
    if (el.type === "radio") return "radio";
    if (el.type === "file") return "file";
  }
  return "text";
}

function optionsOf(el: HTMLElement): string[] | undefined {
  if (el instanceof HTMLSelectElement) return Array.from(el.options).map((option) => option.text).filter(Boolean);
  if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return undefined;
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${CSS.escape(el.name)}"]`))
    .map((radio) => labelFor(radio) || radio.value)
    .filter(Boolean);
}

function fieldValue(el: HTMLElement): string | boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked;
    return el.value;
  }
  return "";
}

function isRequired(element: HTMLElement): boolean {
  return element.getAttribute("aria-required") === "true"
    || (element instanceof HTMLInputElement && element.required)
    || (element instanceof HTMLSelectElement && element.required)
    || element.classList.contains("appFieldRequired")
    || /\*/.test(labelFor(element));
}

function radioGroupQuestion(radio: HTMLInputElement): string {
  const group = radio.closest<HTMLElement>("[role=radiogroup]");
  return cleanLabel(group?.getAttribute("aria-label") || (group ? ariaLabelledByText(group) : "") || radio.name);
}

function radioLabel(radio: HTMLInputElement): string {
  return cleanLabel(radio.getAttribute("aria-label") || labelFor(radio) || radio.value);
}

function isLegalConfirmation(field: FieldDescriptor): boolean {
  const question = normalizeSignal(field.question);
  return field.type === "confirmation" || hasAny(question, [
    "i declare that",
    "consent to its processing",
    "terms of use",
    "privacy statement"
  ]);
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isSearchOrNav(el: HTMLElement): boolean {
  const text = `${el.getAttribute("name") ?? ""} ${el.getAttribute("placeholder") ?? ""}`.toLowerCase();
  return text.includes("search") || text.includes("filter");
}

function directProfileFill(field: FieldDescriptor, profile: Profile): FieldFill | undefined {
  const ref = fieldRefs.get(field.id);
  if (!ref || field.type === "file" || field.type === "confirmation") return undefined;

  const signal = directFieldSignal(field);
  const value = directProfileValue(signal, profile, Array.isArray(ref) ? ref[0] : ref);
  if (value === undefined || value === "") return undefined;

  return { id: field.id, value, source: "profile", confidence: 0.98 };
}

function directFieldSignal(field: FieldDescriptor): string {
  const ref = fieldRefs.get(field.id);
  if (!ref) return "";
  return normalizeSignal([field.question, domSignal(ref)].join(" "));
}

function domSignal(target: FillTarget): string {
  const el = Array.isArray(target) ? target[0] : target;
  if (!el) return "";
  const values = [
    el.id,
    el.getAttribute("name"),
    el.getAttribute("autocomplete"),
    el.getAttribute("aria-label"),
    el.getAttribute("formcontrolname"),
    ancestorSignal(el)
  ];
  return values.filter(Boolean).join(" ");
}

function ancestorSignal(element: HTMLElement): string {
  const values: string[] = [];
  let current = element.parentElement;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
    values.push(current.id, current.getAttribute("name") ?? "", current.getAttribute("data-qa") ?? "");
  }
  return values.filter(Boolean).join(" ");
}

function normalizeSignal(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9+ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function directProfileValue(signal: string, profile: Profile, ref: HTMLElement): string | boolean | undefined {
  if (hasAny(signal, ["first name", "firstname", "given name"])) return profile.identity.firstName;
  if (hasAny(signal, ["middle name", "middlename"])) return profile.identity.middleName;
  if (hasAny(signal, ["last name", "lastname", "surname", "family name"])) return profile.identity.lastName;
  if (hasAny(signal, ["email", "e mail"])) return profile.identity.email;
  if (hasAny(signal, ["country code", "phone country code", "dialing code", "dialling code"])) return profile.identity.phoneCountryCode;
  if (hasAny(signal, ["phone", "mobile", "telephone"])) {
    return hasPhoneCountryControl(ref) ? formatProfileNationalPhone(profile) : formatProfilePhone(profile);
  }
  if (hasAny(signal, ["linkedin"])) return profile.identity.links.linkedin;
  if (hasAny(signal, ["github"])) return profile.identity.links.github;
  if (hasAny(signal, ["portfolio"])) return profile.identity.links.portfolio || profile.identity.links.website;
  if (hasAny(signal, ["personal website", "website"])) return profile.identity.links.website || profile.identity.links.portfolio;
  if (hasAny(signal, ["address line 1", "address 1", "street address"])) return profile.identity.address.line1;
  if (hasAny(signal, ["address line 2", "address 2", "apartment", "suite"])) return profile.identity.address.line2;
  if (hasAny(signal, ["postal code", "zip code", " zip "])) return profile.identity.address.postalCode;
  if (hasAny(signal, ["city"])) return profile.identity.location.city;
  if (hasAny(signal, ["state", "province", "region"])) return profile.identity.location.state;
  if (hasAny(signal, ["visa status", "immigration status"])) return profile.workAuthorization.visaStatus;
  if (hasAny(signal, ["sponsorship", "sponsor"])) return profile.workAuthorization.requiresSponsorship;
  if (hasAny(signal, ["how did you hear", "referral source"])) return profile.applicationDefaults.referralSource;
  if (hasAny(signal, ["if other please provide details"])) return profile.applicationDefaults.referralDetails;
  if (hasAny(signal, ["employee referral", "referral name"])) return profile.applicationDefaults.employeeReferralName;
  if (hasAny(signal, ["reasonable adjustments", "recruitment adjustments", "accommodations"])) return profile.applicationDefaults.needsRecruitmentAdjustments;
  if (hasAny(signal, ["if yes please specify", "adjustment details"])) return profile.applicationDefaults.recruitmentAdjustmentsDetails;
  if (hasAny(signal, ["previously been employed by a company within the fitch group", "previously employed by fitch"])) return profile.applicationDefaults.previouslyEmployedByFitch;
  if (hasAny(signal, ["current employer", "current company"])) return profile.applicationDefaults.currentEmployer || profile.experience[0]?.company;
  if (hasAny(signal, ["current title", "current job title"])) return profile.applicationDefaults.currentTitle || profile.experience[0]?.title;
  if (hasAny(signal, ["current salary", "current compensation"])) return profile.applicationDefaults.currentSalary;
  if (hasAny(signal, ["desired salary", "salary expectation", "expected salary"])) return profile.applicationDefaults.desiredSalary;
  if (hasAny(signal, ["currency"])) return profile.applicationDefaults.salaryCurrency;
  if (hasAny(signal, ["make my profile visible", "profile visibility"])) return profile.applicationDefaults.profileVisibility;
  if (hasAny(signal, ["job posting notifications", "job notifications", "notification"])) return profile.applicationDefaults.jobNotifications;
  if (hasAny(signal, ["self identified gender", "gender identity"])) return profile.demographics.gender;
  if (hasAny(signal, ["ethnic origin", "ethnicity"])) return profile.demographics.race;
  if (hasAny(signal, ["veteran status", "protected veteran"])) return profile.demographics.veteran;
  if (hasAny(signal, ["consider yourself to have a disability", "disability status", "long term condition"])) return profile.demographics.disability;
  if (hasAny(signal, ["country"])) return profile.identity.location.country;
  if (hasAny(signal, ["authorized", "authorization"])) return profile.workAuthorization.usAuthorized;
  return undefined;
}

function hasPhoneCountryControl(ref: HTMLElement): boolean {
  const container = ref.parentElement;
  return Boolean(container?.querySelector("button,[role=button],select"))
    || Boolean(document.querySelector('[role="combobox"][aria-label*="Country Code" i], select[aria-label*="Country Code" i]'));
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function mergeFills(primary: FieldFill[], secondary: FieldFill[]): FieldFill[] {
  const fills = new Map<string, FieldFill>();
  for (const fill of secondary) fills.set(fill.id, fill);
  for (const fill of primary) fills.set(fill.id, fill);
  return Array.from(fills.values());
}

async function attachStoredResume(profile: Profile): Promise<{ opened: boolean; review?: AutofillReviewItem }> {
  const trigger = findResumeAttachmentTrigger();
  if (!trigger) return { opened: false };

  if (!profile.resumeFile) {
    trigger.click();
    return {
      opened: true,
      review: {
        id: "resume",
        question: "Resume",
        status: "confirmation",
        detail: "Choose a resume file, or import one into the master profile for automatic attachment."
      }
    };
  }

  const input = trigger instanceof HTMLInputElement && trigger.type === "file"
    ? trigger
    : await openUploadAndFindInput(trigger, isResumeElement);
  if (!input) {
    return {
      opened: true,
      review: { id: "resume", question: "Resume", status: "unsupported", detail: "The resume upload dialog did not expose a file input." }
    };
  }

  const file = dataUrlToFile(profile.resumeFile.dataUrl, profile.resumeFile.name, profile.resumeFile.type);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const attached = input.files?.[0]?.name === profile.resumeFile.name;
  return {
    opened: trigger !== input,
    review: {
      id: "resume",
      question: "Resume",
      status: attached ? "filled" : "unsupported",
      detail: attached ? `Attached ${profile.resumeFile.name}.` : "The page rejected the stored resume file."
    }
  };
}

async function attachStoredCoverLetter(profile: Profile): Promise<{ opened: boolean; review?: AutofillReviewItem }> {
  if (!profile.coverLetterFile) return { opened: false };
  const trigger = Array.from(document.querySelectorAll<HTMLElement>("button,a,label,[role=button],input[type=file]")).find((element) =>
    isVisible(element) && isCoverLetterElement(element)
  );
  if (!trigger) {
    return {
      opened: false,
      review: { id: "cover-letter", question: "Cover letter", status: "unsupported", detail: "No cover letter upload control was detected." }
    };
  }
  const input = trigger instanceof HTMLInputElement && trigger.type === "file"
    ? trigger
    : await openUploadAndFindInput(trigger, isCoverLetterElement);
  if (!input) {
    return {
      opened: true,
      review: { id: "cover-letter", question: "Cover letter", status: "unsupported", detail: "The cover letter dialog did not expose a file input." }
    };
  }
  const file = dataUrlToFile(profile.coverLetterFile.dataUrl, profile.coverLetterFile.name, profile.coverLetterFile.type);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const attached = input.files?.[0]?.name === profile.coverLetterFile.name;
  return {
    opened: trigger !== input,
    review: {
      id: "cover-letter",
      question: "Cover letter",
      status: attached ? "filled" : "unsupported",
      detail: attached ? `Attached ${profile.coverLetterFile.name}.` : "The page rejected the stored cover letter."
    }
  };
}

async function openUploadAndFindInput(trigger: HTMLElement, matchesAttachment: (element: HTMLElement) => boolean): Promise<HTMLInputElement | undefined> {
  trigger.click();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[type=file]"));
    const input = inputs.find(matchesAttachment) ?? inputs.find(isVisible) ?? (inputs.length === 1 ? inputs[0] : undefined);
    if (input) return input;
    await wait(50);
  }
  return undefined;
}

function dataUrlToFile(dataUrl: string, name: string, type: string): File {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!match) throw new Error("Stored resume data is invalid.");
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  return new File([bytes], name, { type: type || match[1] || "application/octet-stream" });
}

function findResumeAttachmentTrigger(): HTMLElement | undefined {
  const fileInput = Array.from(document.querySelectorAll<HTMLInputElement>("input[type=file]")).find((input) =>
    isResumeElement(input)
  );
  if (fileInput && isVisible(fileInput)) return fileInput;

  const label = fileInput?.id
    ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(fileInput.id)}"]`)
    : undefined;
  if (label && isVisible(label)) return label;

  return Array.from(document.querySelectorAll<HTMLElement>("button,a,label,[role=button]")).find((el) => {
    if (el.id === "job-autofill-button" || el.id === "job-autofill-resume-button") return false;
    if (!isVisible(el)) return false;
    return isResumeElement(el);
  });
}

function isResumeElement(el: HTMLElement): boolean {
  const text = normalizeSignal(
    [
      el.innerText,
      el.textContent,
      el.id,
      el.getAttribute("name"),
      el.getAttribute("aria-label"),
      el.getAttribute("data-testid"),
      el.getAttribute("accept")
    ]
      .filter(Boolean)
      .join(" ")
  );
  return (
    hasAny(text, ["resume", "cv", "curriculum vitae"]) &&
    hasAny(text, ["attach", "upload", "file", "resume", "cv", "pdf"])
  );
}

function isCoverLetterElement(element: HTMLElement): boolean {
  const text = normalizeSignal([
    element.innerText,
    element.textContent,
    element.id,
    element.getAttribute("name"),
    element.getAttribute("aria-label"),
    element.getAttribute("data-testid")
  ].filter(Boolean).join(" "));
  return hasAny(text, ["cover letter", "coverletter"]);
}

function isSuccessFactorsHyperlinkTrigger(element: HTMLElement): boolean {
  return element.getAttribute("role") === "button" && element.classList.contains("rcmHyperlinkIconAdd");
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function extractJobDescription(): string {
  const selectors = [
    "[data-automation-id='jobPostingDescription']",
    ".job__description",
    ".posting-page",
    ".jobs-description",
    "main"
  ];
  const text = selectors.map((selector) => document.querySelector<HTMLElement>(selector)?.innerText ?? "").find((value) => value.length > 300);
  return (text ?? document.body.innerText).slice(0, 12000);
}

function extractJobLocation(): string {
  const direct = findTextBySelectors([
    "[data-automation-id='location']",
    "[data-testid='job-location']",
    "[class*='location']",
    ".posting-categories",
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__bullet"
  ]);
  if (direct) return cleanLocationText(direct);

  const titleMatch = cleanTitle(document.title).match(/\b(Remote|Hybrid|On-site|Onsite)?[,]?\s*([A-Z][A-Za-z .-]+,\s*[A-Z][A-Za-z .-]+)$/);
  return cleanLocationText(titleMatch?.[0] ?? "");
}

function cleanLocationText(value: string): string {
  return cleanTitle(value)
    .replace(/\b(remote|hybrid|on-site|onsite)\b/gi, "")
    .replace(/\s*[•|-]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectWorkMode(): Application["workMode"] {
  const text = normalizeSignal([document.title, document.body?.innerText ?? ""].join(" "));
  if (hasAny(text, ["hybrid"])) return "Hybrid";
  if (hasAny(text, ["on site", "onsite", "in office"])) return "On-site";
  if (hasAny(text, ["remote", "work from home"])) return "Remote";
  return "";
}

function getPageContext(): PageContext {
  const vendorContext = getVendorPageContext();
  if (vendorContext) return vendorContext;

  const title = cleanTitle(document.title);
  const source = detectSource(location.hostname);
  const headings = visibleHeadings();
  return {
    url: location.href,
    title,
    source,
    company: guessCompany(title, headings),
    role: guessRole(title, headings)
  };
}

function getVendorPageContext(): PageContext | undefined {
  if (location.hostname.includes("comeet.co")) return getComeetPageContext();
  if (location.hostname.includes("linkedin.com")) return getLinkedInPageContext();
  if (location.hostname.includes("indeed.com")) return getIndeedPageContext();
  return undefined;
}

function getComeetPageContext(): PageContext {
  const title = cleanTitle(document.title);
  const headings = visibleHeadings();
  const params = new URL(location.href).searchParams;
  const company = firstUseful([
    params.get("company-name"),
    extractCompanyFromTitle(title),
    findTextBySelectors(["[class*='company']", "[data-company]", ".company"])
  ]);
  const role = firstUseful([
    findTextBySelectors(["h1", "[class*='job-title']", "[class*='position-title']", "[data-job-title]"]),
    headings.find((heading) => !looksLikeCompany(heading, company)),
    extractRoleFromTitle(title)
  ]);

  return {
    url: location.href,
    title,
    source: "Comeet",
    company: company || "Company",
    role: role || title || "Role"
  };
}

function getLinkedInPageContext(): PageContext {
  const title = cleanTitle(document.title);
  const headings = visibleHeadings();
  const role = firstUseful([
    findTextBySelectors([
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
      "[data-test-job-title]",
      "h1"
    ]),
    headings.find((heading) => !/easy apply|apply/i.test(heading)),
    extractRoleFromTitle(title)
  ]);
  const company = firstUseful([
    findTextBySelectors([
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name",
      "[data-test-job-company-name]",
      "a[href*='/company/']"
    ]),
    extractCompanyFromTitle(title)
  ]);

  return {
    url: location.href,
    title,
    source: "LinkedIn",
    company: company || "Company",
    role: role || title || "Role"
  };
}

function getIndeedPageContext(): PageContext {
  const title = cleanTitle(document.title);
  const headings = visibleHeadings();
  const role = firstUseful([
    findTextBySelectors([
      "[data-testid='jobsearch-JobInfoHeader-title']",
      ".jobsearch-JobInfoHeader-title",
      "[data-testid='job-title']",
      "h1"
    ]),
    headings.find((heading) => !/apply|application/i.test(heading)),
    extractRoleFromTitle(title)
  ]);
  const company = firstUseful([
    findTextBySelectors([
      "[data-testid='inlineHeader-companyName']",
      "[data-company-name='true']",
      ".jobsearch-CompanyInfoContainer a",
      ".jobsearch-InlineCompanyRating a"
    ]),
    extractCompanyFromTitle(title)
  ]);

  return {
    url: location.href,
    title,
    source: "Indeed",
    company: company || "Company",
    role: role || title || "Role"
  };
}

function watchSubmit(): void {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button,input[type=submit]") as HTMLElement | null;
      if (!button || !isFinalSubmitControl(button)) return;
      requestTrackCurrentApplication();
    },
    true
  );

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target as HTMLFormElement | null;
      if (!form || !formMatchesApplication(form)) return;
      requestTrackCurrentApplication();
    },
    true
  );
}

function isFinalSubmitControl(button: HTMLElement): boolean {
  const text = normalizeSignal(buttonLabel(button));
  if (!text) return false;
  if (hasAny(text, ["next", "continue", "review", "easy apply", "apply now", "start application"])) return false;
  return /(^|\s)(submit|send)(\s|$)/.test(text) || hasAny(text, ["submit application", "submit your application", "send application"]);
}

function buttonLabel(button: HTMLElement): string {
  const values = [
    button.innerText,
    button.textContent,
    button.getAttribute("value"),
    button.getAttribute("aria-label"),
    button.getAttribute("data-control-name"),
    button.getAttribute("data-testid")
  ];
  return values.filter(Boolean).join(" ");
}

function formMatchesApplication(form: HTMLFormElement): boolean {
  const text = normalizeSignal([form.innerText, form.id, form.getAttribute("name"), form.getAttribute("aria-label")].filter(Boolean).join(" "));
  const fields = Array.from(form.querySelectorAll("input,textarea,select"));
  return fields.length >= 3 && hasAny(text, ["application", "resume", "cover letter", "linkedin", "phone", "email"]);
}

function requestTrackCurrentApplication(): void {
  queueTrackCurrentApplication();
}

function queueTrackCurrentApplication(): PendingApplication {
  const context = getPageContext();
  const key = `${context.source}|${context.company}|${context.role}|${canonicalJobUrl(context.url)}`;

  const application: Application = {
    company: context.company,
    role: context.role,
    jobUrl: context.url,
    source: context.source,
    dateApplied: new Date().toISOString(),
    status: "Applied",
    location: extractJobLocation(),
    workMode: detectWorkMode(),
    jobDescription: extractJobDescription().slice(0, 5000),
    answersUsed: extractFields()
      .filter((field) => field.value)
      .map((field) => ({ question: field.question, answer: String(field.value ?? "") })),
    notes: ""
  };

  const pending: PendingApplication = {
    id: key,
    application,
    createdAt: new Date().toISOString()
  };
  if (!loggedSubmissionKeys.has(key)) {
    loggedSubmissionKeys.add(key);
    void chrome.runtime.sendMessage({ kind: "OPEN_TRACKER_PASTE", pending } satisfies ExtensionMessage);
  }
  return pending;
}

function canonicalJobUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const jobId =
      parsed.searchParams.get("currentJobId") ||
      parsed.searchParams.get("jk") ||
      parsed.searchParams.get("jobKey") ||
      parsed.pathname;
    return `${parsed.hostname}${jobId}`;
  } catch {
    return url;
  }
}

function detectSource(hostname: string): string {
  if (hostname.includes("comeet")) return "Comeet";
  if (hostname.includes("greenhouse")) return "Greenhouse";
  if (hostname.includes("lever")) return "Lever";
  if (hostname.includes("ashby")) return "Ashby";
  if (hostname.includes("linkedin")) return "LinkedIn";
  if (hostname.includes("indeed")) return "Indeed";
  return "Web";
}

function guessCompany(title: string, headings: Array<string | undefined>): string {
  const heading = headings.find(Boolean) ?? title;
  return extractCompanyFromTitle(title) || heading.split("-").at(-1)?.trim() || "";
}

function guessRole(title: string, headings: Array<string | undefined>): string {
  return headings.find((heading) => heading && !looksLikeCompany(heading, guessCompany(title, headings))) || extractRoleFromTitle(title) || title;
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function visibleHeadings(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3"))
    .filter(isVisible)
    .map((el) => cleanTitle(el.innerText || el.textContent || ""))
    .filter(Boolean)
    .filter((text) => !/career center|apply|application form/i.test(text));
}

function findTextBySelectors(selectors: string[]): string {
  for (const selector of selectors) {
    const text = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter(isVisible)
      .map((el) => cleanTitle(el.innerText || el.textContent || ""))
      .find(Boolean);
    if (text) return text;
  }
  return "";
}

function firstUseful(values: Array<string | null | undefined>): string {
  return values.map((value) => cleanTitle(value ?? "")).find((value) => value.length > 0) ?? "";
}

function extractCompanyFromTitle(title: string): string {
  const parts = title.split("|").map(cleanTitle).filter(Boolean);
  if (parts.length < 2) return "";
  return parts.at(-1)?.replace(/\bjobs\b/i, "").trim() ?? "";
}

function extractRoleFromTitle(title: string): string {
  const parts = title.split("|").map(cleanTitle).filter(Boolean);
  if (parts.length === 0) return "";
  const role = parts[0];
  if (/jobs|careers|spark hire/i.test(role)) return "";
  return role;
}

function looksLikeCompany(value: string | undefined, company: string): boolean {
  if (!value || !company) return false;
  return normalizeSignal(value).includes(normalizeSignal(company));
}
