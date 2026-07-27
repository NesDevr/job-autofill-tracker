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
