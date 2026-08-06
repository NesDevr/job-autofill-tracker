import type { Application } from "./schema";

export function localTodayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function isFollowUpDue(application: Application, todayISO: string): boolean {
  if (!application.nextActionDate) return false;
  if (application.status === "Rejected" || application.status === "Ghosted") return false;
  return application.nextActionDate.slice(0, 10) <= todayISO;
}

export function applicationToClipboardText(application: Application): string {
  const compensation = application.compensation;
  const upwork = application.upwork;
  return [
    `${application.role || "Untitled role"} at ${application.company || "Unknown company"}`,
    [
      `Company: ${application.company}`,
      `Role: ${application.role}`,
      `Status: ${application.status}`,
      `Source: ${application.source}`,
      `Job URL: ${application.jobUrl}`,
      `Date applied: ${application.dateApplied.slice(0, 10)}`,
      application.nextActionDate ? `Next action date: ${application.nextActionDate.slice(0, 10)}` : "",
      application.location ? `Location: ${application.location}` : "",
      application.workMode ? `Work mode: ${application.workMode}` : "",
      application.resumeVersion ? `Resume version: ${application.resumeVersion}` : ""
    ].filter(Boolean).join("\n"),
    compensation
      ? [
          "Compensation",
          compensation.text ? `Details: ${compensation.text}` : "",
          compensation.currency ? `Currency: ${compensation.currency}` : "",
          compensation.min != null ? `Minimum: ${compensation.min}` : "",
          compensation.max != null ? `Maximum: ${compensation.max}` : "",
          compensation.period ? `Period: ${compensation.period}` : ""
        ].filter(Boolean).join("\n")
      : "",
    upwork
      ? [
          "Upwork proposal",
          `Status: ${upwork.status}`,
          upwork.contractType ? `Contract type: ${upwork.contractType}` : "",
          upwork.proposedAmount != null ? `Proposed amount: ${upwork.currency ? `${upwork.currency} ` : ""}${upwork.proposedAmount}` : "",
          upwork.baseConnects != null ? `Base Connects: ${upwork.baseConnects}` : "",
          upwork.boostBid != null ? `Boost bid: ${upwork.boostBid}` : "",
          upwork.boostCharged != null ? `Boost charged: ${upwork.boostCharged}` : "",
          upwork.respondedAt ? `Responded: ${upwork.respondedAt.slice(0, 10)}` : "",
          upwork.interviewedAt ? `Interviewed: ${upwork.interviewedAt.slice(0, 10)}` : "",
          upwork.offeredAt ? `Offered: ${upwork.offeredAt.slice(0, 10)}` : "",
          upwork.hiredAt ? `Hired: ${upwork.hiredAt.slice(0, 10)}` : ""
        ].filter(Boolean).join("\n")
      : "",
    application.notes ? `Notes\n${application.notes}` : "",
    application.jobDescription ? `Job description\n${application.jobDescription}` : "",
    application.answersUsed.length > 0
      ? `Application answers\n${application.answersUsed.map((item) => `Question: ${item.question}\nAnswer: ${item.answer}`).join("\n\n")}`
      : ""
  ].filter(Boolean).join("\n\n");
}

export function canonicalJobUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Upwork exposes the same job at /jobs/~id and /nx/find-work/.../details/~id,
    // so canonicalize on the ~id token to dedupe across both.
    const upworkId = parsed.hostname.endsWith("upwork.com") ? parsed.pathname.match(/~[0-9a-z]+/i)?.[0] : undefined;
    const jobId =
      parsed.searchParams.get("currentJobId") ||
      parsed.searchParams.get("jk") ||
      parsed.searchParams.get("jobKey") ||
      upworkId ||
      parsed.pathname;
    return `${parsed.hostname}${jobId}`;
  } catch {
    return url;
  }
}

export function isJobDetailUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (host.endsWith("linkedin.com")) return path.includes("/jobs/view/") || parsed.searchParams.has("currentJobId");
    if (host.endsWith("indeed.com")) return path.includes("/viewjob") || parsed.searchParams.has("vjk");
    if (host.endsWith("upwork.com")) return /~[0-9a-z]+/i.test(path);
    return false;
  } catch {
    return false;
  }
}
