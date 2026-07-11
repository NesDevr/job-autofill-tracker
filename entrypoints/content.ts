import { applyFill } from "../lib/fillers";
import { formatProfileNationalPhone, formatProfilePhone } from "../lib/profileValues";
import { getProfile } from "../lib/storage";
import type { Application, ExtensionMessage, FieldDescriptor, FieldFill, PageContext, PendingApplication, Profile } from "../lib/schema";

const fieldRefs = new Map<string, HTMLElement>();
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

async function fillCurrentForm(): Promise<{ ok: true; filled: number; resumeOpened: boolean }> {
  const fields = extractFields();
  const profile = await getProfile();
  const localFills = fields.map((field) => directProfileFill(field, profile)).filter(Boolean) as FieldFill[];
  const request: ExtensionMessage = {
    kind: "MAP_FIELDS",
    fields,
    jobDescription: extractJobDescription(),
    page: getPageContext()
  };
  const response = await chrome.runtime.sendMessage(request);
  if (!response?.ok) throw new Error(response?.error ?? "Mapping failed.");

  const fills = mergeFills(localFills, response.fills as FieldFill[]);
  for (const fill of fills) {
    const ref = fieldRefs.get(fill.id);
    if (ref) applyFill(ref, fill);
  }
  const resumeOpened = openResumeAttachment();
  return { ok: true, filled: fills.length, resumeOpened };
}

function extractFields(): FieldDescriptor[] {
  fieldRefs.clear();
  const selectors = "input:not([type=hidden]), textarea, select";
  return Array.from(document.querySelectorAll<HTMLElement>(selectors))
    .filter((el) => isVisible(el) && !isSearchOrNav(el))
    .map((el, index) => {
      const id = `field-${index}`;
      fieldRefs.set(id, el);
      return {
        id,
        question: describeField(el),
        type: fieldType(el),
        options: optionsOf(el),
        value: fieldValue(el)
      };
    })
    .filter((field) => field.question.length > 0);
}

function describeField(el: HTMLElement): string {
  const pieces = [
    labelFor(el),
    el.getAttribute("aria-label"),
    ariaLabelledByText(el),
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.placeholder : "",
    nearestText(el),
    el.getAttribute("name"),
    el.id
  ];
  return pieces.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
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
  const parent = el.closest("fieldset, [data-qa], .field, .application-question, div") as HTMLElement | null;
  if (!parent) return "";
  return parent.innerText.replace(el instanceof HTMLInputElement ? el.value : "", "").slice(0, 280);
}

function fieldType(el: HTMLElement): FieldDescriptor["type"] {
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLInputElement) {
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

function fieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  return "";
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
  if (!ref || field.type === "file") return undefined;

  const signal = directFieldSignal(field);
  const value = directProfileValue(signal, profile, ref);
  if (value === undefined || value === "") return undefined;

  return { id: field.id, value, source: "profile", confidence: 0.98 };
}

function directFieldSignal(field: FieldDescriptor): string {
  const ref = fieldRefs.get(field.id);
  if (!ref) return "";
  return normalizeSignal([field.question, domSignal(ref)].join(" "));
}

function domSignal(el: HTMLElement): string {
  const values = [
    el.id,
    el.getAttribute("name"),
    el.getAttribute("autocomplete"),
    el.getAttribute("aria-label"),
    el.getAttribute("formcontrolname")
  ];
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
  if (hasAny(signal, ["last name", "lastname", "surname", "family name"])) return profile.identity.lastName;
  if (hasAny(signal, ["email", "e mail"])) return profile.identity.email;
  if (hasAny(signal, ["phone", "mobile", "telephone"])) {
    return hasPhoneCountryControl(ref) ? formatProfileNationalPhone(profile) : formatProfilePhone(profile);
  }
  if (hasAny(signal, ["linkedin"])) return profile.identity.links.linkedin;
  if (hasAny(signal, ["github"])) return profile.identity.links.github;
  if (hasAny(signal, ["portfolio"])) return profile.identity.links.portfolio || profile.identity.links.website;
  if (hasAny(signal, ["personal website", "website"])) return profile.identity.links.website || profile.identity.links.portfolio;
  if (hasAny(signal, ["city"])) return profile.identity.location.city;
  if (hasAny(signal, ["state", "province", "region"])) return profile.identity.location.state;
  if (hasAny(signal, ["country"])) return profile.identity.location.country;
  if (hasAny(signal, ["authorized", "authorization"])) return profile.workAuthorization.usAuthorized;
  if (hasAny(signal, ["sponsorship", "sponsor"])) return profile.workAuthorization.requiresSponsorship;
  return undefined;
}

function hasPhoneCountryControl(ref: HTMLElement): boolean {
  const container = ref.parentElement;
  return Boolean(container?.querySelector("button,[role=button],select"));
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

function openResumeAttachment(): boolean {
  const trigger = findResumeAttachmentTrigger();
  if (!trigger) return false;
  trigger.click();
  return true;
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
  const pending = queueTrackCurrentApplication();
  showTrackPrompt(pending);
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
      .map((field) => ({ question: field.question, answer: field.value ?? "" })),
    notes: ""
  };

  const pending: PendingApplication = {
    id: key,
    application,
    createdAt: new Date().toISOString()
  };
  if (!loggedSubmissionKeys.has(key)) {
    loggedSubmissionKeys.add(key);
    void chrome.runtime.sendMessage({ kind: "QUEUE_PENDING_APPLICATION", pending } satisfies ExtensionMessage);
  }
  return pending;
}

function showTrackPrompt(pending: PendingApplication): void {
  const existing = document.getElementById("job-autofill-track-prompt");
  existing?.remove();

  const prompt = document.createElement("aside");
  prompt.id = "job-autofill-track-prompt";
  prompt.setAttribute("role", "dialog");
  prompt.setAttribute("aria-label", "Add application with Paste AI");
  prompt.innerHTML = `
    <div class="job-autofill-track-title">Add with Paste AI?</div>
    <div class="job-autofill-track-body">${escapeHtml(pending.application.company)} - ${escapeHtml(pending.application.role)}</div>
    <div class="job-autofill-track-actions">
      <button type="button" data-action="skip">Dismiss</button>
      <button type="button" data-action="paste">Paste AI</button>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #job-autofill-track-prompt {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      width: min(320px, calc(100vw - 36px));
      border: 1px solid #1f2a33;
      border-radius: 8px;
      background: #fffaf2;
      box-shadow: 0 18px 48px rgba(16, 24, 32, 0.24);
      color: #101820;
      font-family: Aptos, "Segoe UI", sans-serif;
      padding: 12px;
    }

    #job-autofill-track-prompt .job-autofill-track-title {
      font-size: 13px;
      font-weight: 800;
      margin-bottom: 4px;
    }

    #job-autofill-track-prompt .job-autofill-track-body {
      color: #465360;
      font-size: 12px;
      line-height: 1.35;
      margin-bottom: 10px;
    }

    #job-autofill-track-prompt .job-autofill-track-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    #job-autofill-track-prompt button {
      border: 1px solid #c6b9a8;
      border-radius: 7px;
      background: #fffaf2;
      color: #101820;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 800;
      min-height: 32px;
      padding: 0 10px;
    }

    #job-autofill-track-prompt button[data-action="paste"] {
      border-color: #27745f;
      background: #27745f;
      color: #fffdf8;
    }
  `;
  prompt.append(style);

  prompt.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest("button");
    if (!button) return;
    if (button.dataset.action === "paste") {
      void chrome.runtime.sendMessage({ kind: "OPEN_TRACKER_PASTE", pending } satisfies ExtensionMessage);
    } else {
      void chrome.runtime.sendMessage({ kind: "REMOVE_PENDING_APPLICATION", id: pending.id } satisfies ExtensionMessage);
    }
    prompt.remove();
  });

  document.documentElement.append(prompt);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === "\"") return "&quot;";
    return "&#39;";
  });
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
