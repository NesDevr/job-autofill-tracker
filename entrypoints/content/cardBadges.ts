import { scoreAffinity } from "../../lib/affinity";
import type { Profile } from "../../lib/schema";

// Injects Simplify-style match-score pills onto job list cards on LinkedIn and
// Indeed search pages. Badges live in the page DOM (not the widget's shadow
// root), so styling is one prefixed <style> tag to avoid host-page collisions.

const STYLE_ID = "jt-card-badge-style";
const SCORED_ATTR = "data-jt-scored";

const CARD_SELECTORS: Record<string, string> = {
  linkedin: `li[data-occludable-job-id]:not([${SCORED_ATTR}])`,
  indeed: `#mosaic-provider-jobcards [data-jk]:not([${SCORED_ATTR}]), li [data-jk]:not([${SCORED_ATTR}])`
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

export function initCardBadges(profile: Profile): void {
  const site = siteKey();
  if (!site) return;

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
      card.setAttribute(SCORED_ATTR, "1");
      const text = card.innerText.slice(0, 1000);
      if (!text.trim()) continue;
      const { score, jobTermCount } = scoreAffinity(profile, text);
      // Cards without recognizable skill terms are common (title + company +
      // location only) — no badge is the honest signal there.
      if (jobTermCount === 0) continue;
      if (!card.style.position) card.style.position = "relative";
      const badge = document.createElement("span");
      badge.className = `jtCardBadge ${badgeTier(score)}`;
      badge.textContent = String(score);
      badge.title = "JobTracker skill match score";
      card.appendChild(badge);
    }
  };

  let debounceTimer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(scanCards, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scanCards();
}
