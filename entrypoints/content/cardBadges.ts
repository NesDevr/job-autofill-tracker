import { scoreAffinity } from "../../lib/affinity";
import { applicationsAtCompany, canonicalCompanyName, companyNameMatches } from "../../lib/jobs";
import { getSettings } from "../../lib/storage";
import type { Application, ExtensionMessage, Profile } from "../../lib/schema";

// Injects Simplify-style match-score pills onto job list cards on LinkedIn and
// Indeed search pages. Badges live in the page DOM (not the widget's shadow
// root), so styling is one prefixed <style> tag to avoid host-page collisions.

const STYLE_ID = "jt-card-badge-style";
const SCORED_ATTR = "data-jt-scored";

const CARD_SELECTORS: Record<string, string> = {
  linkedin: "li[data-occludable-job-id], div[role='button'][componentkey^='job-card-component-ref-']",
  indeed: "#mosaic-provider-jobcards [data-testid='slider_item']"
};

const COMPANY_SELECTORS: Record<string, string> = {
  linkedin: ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .job-card-list__company-name, [data-test-job-card-company-name]",
  indeed: "[data-testid='company-name'], .companyName"
};

const BADGE_CSS = `
.jtCardBadge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
  padding: 2px 8px;
  border-radius: 999px;
  font: 700 11px/1.4 system-ui, sans-serif;
  color: #fff;
  pointer-events: none;
}
.jtCardBadgeHigh { background: #27745f; }
.jtCardBadgeMid { background: #b87918; }
.jtCardBadgeLow { background: #51606d; }
.jtCompanyHistoryBadge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid #d09132;
  border-radius: 999px;
  background: #fff7e7;
  color: #7a4700;
  font: 800 10px/1.5 system-ui, sans-serif;
  letter-spacing: .01em;
  vertical-align: 1px;
  pointer-events: none;
}
.jtIgnoredCompanyBadge {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid #c66161;
  border-radius: 999px;
  background: #fff0f0;
  color: #8b2525;
  font: 800 10px/1.5 system-ui, sans-serif;
  letter-spacing: .01em;
  vertical-align: 1px;
  pointer-events: none;
}
@media (prefers-color-scheme: dark) {
  .jtCompanyHistoryBadge {
    border-color: #9a6a27;
    background: #302414;
    color: #f0bd66;
  }
  .jtIgnoredCompanyBadge {
    border-color: #934848;
    background: #321b1b;
    color: #f19a9a;
  }
}
`;

function siteKey(): string | undefined {
  if (location.hostname.includes("linkedin.com")) return "linkedin";
  if (location.hostname.includes("indeed.com")) return "indeed";
  return undefined;
}

function badgeTier(score: number): string {
  if (score >= 70) return "jtCardBadgeHigh";
  if (score >= 40) return "jtCardBadgeMid";
  return "jtCardBadgeLow";
}

function companyText(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".jtCompanyHistoryBadge, .jtIgnoredCompanyBadge").forEach((badge) => badge.remove());
  return (copy.textContent ?? "").trim().split("\n")[0].trim();
}

function cardKey(card: HTMLElement, company: string): string {
  const componentKey = card.getAttribute("componentkey") ?? "";
  const jobId = card.getAttribute("data-occludable-job-id")
    ?? card.querySelector("[data-jk]")?.getAttribute("data-jk")
    ?? componentKey.replace("job-card-component-ref-", "");
  return `${jobId}:${canonicalCompanyName(company)}`;
}

function companyElementForCard(card: HTMLElement, site: string): HTMLElement | undefined {
  const knownElement = card.querySelector<HTMLElement>(COMPANY_SELECTORS[site]);
  if (knownElement) return knownElement;
  if (site !== "linkedin" || !card.getAttribute("componentkey")?.startsWith("job-card-component-ref-")) return undefined;
  return Array.from(card.querySelectorAll<HTMLElement>("p")).filter((element) => companyText(element))[1];
}

export function initCardBadges(profile: Profile | undefined, initialApplications: Application[], initialIgnoredCompanies: string[]): void {
  const site = siteKey();
  if (!site) return;
  let applications = initialApplications;
  let ignoredCompanies = initialIgnoredCompanies;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = BADGE_CSS;
  document.head.appendChild(style);

  let warned = false;
  const scanCards = () => {
    const cards = document.querySelectorAll<HTMLElement>(CARD_SELECTORS[site]);
    if (cards.length === 0 && !warned && /\/jobs\/search|\/jobs\?|q=/.test(location.href)) {
      warned = true;
      console.warn("JobTracker: no job cards matched on this search page; card selectors may be stale.");
    }
    for (const card of cards) {
      const text = card.innerText.slice(0, 1000);
      if (!text.trim()) continue;
      const companyElement = companyElementForCard(card, site);
      if (!companyElement) continue;
      const company = companyText(companyElement);
      if (!company) continue;
      const key = cardKey(card, company);
      if (card.getAttribute(SCORED_ATTR) === key) continue;
      card.querySelectorAll(".jtCardBadge, .jtCompanyHistoryBadge, .jtIgnoredCompanyBadge").forEach((badge) => badge.remove());

      if (ignoredCompanies.some((ignoredCompany) => companyNameMatches(ignoredCompany, company))) {
        const ignoredBadge = document.createElement("span");
        ignoredBadge.className = "jtIgnoredCompanyBadge";
        ignoredBadge.textContent = "Ignored company";
        ignoredBadge.title = `${company} is on your ignored-company list`;
        companyElement.appendChild(ignoredBadge);
      }

      const priorApplications = applicationsAtCompany(applications, company);
      if (priorApplications.length > 0) {
        const historyBadge = document.createElement("span");
        historyBadge.className = "jtCompanyHistoryBadge";
        historyBadge.textContent = priorApplications.length === 1 ? "Applied before" : `Applied before · ${priorApplications.length}`;
        historyBadge.title = `${priorApplications.length} previous application${priorApplications.length === 1 ? "" : "s"} at ${company}`;
        companyElement.appendChild(historyBadge);
      }

      if (profile) {
        const { score, jobTermCount } = scoreAffinity(profile, text);
        // Cards without recognizable skill terms are common (title + company +
        // location only) — no badge is the honest signal there.
        if (jobTermCount > 0) {
          if (!card.style.position) card.style.position = "relative";
          const badge = document.createElement("span");
          badge.className = `jtCardBadge ${badgeTier(score)}`;
          badge.textContent = String(score);
          badge.title = "JobTracker skill match score";
          card.appendChild(badge);
        }
      }
      card.setAttribute(SCORED_ATTR, key);
    }
  };

  let scanTimer = 0;
  const observer = new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scanCards();
    }, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  scanCards();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || (!changes.applicationsRev && !changes.settings)) return;
    void Promise.all([
      chrome.runtime.sendMessage({ kind: "LIST_APPLICATIONS" } satisfies ExtensionMessage),
      getSettings()
    ]).then(([response, settings]) => {
      if (!response?.ok) throw new Error(response?.error ?? "Refreshing tracked companies failed.");
      applications = response.applications as Application[];
      ignoredCompanies = settings.ignoredCompanies;
      document.querySelectorAll(`.jtCompanyHistoryBadge, .jtIgnoredCompanyBadge`).forEach((badge) => badge.remove());
      document.querySelectorAll(`[${SCORED_ATTR}]`).forEach((card) => card.removeAttribute(SCORED_ATTR));
      scanCards();
    });
  });
}
