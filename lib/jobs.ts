import type { Application } from "./schema";

export function localDateISO(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localTodayISO(): string {
  return localDateISO(new Date());
}

export function canonicalCompanyName(company: string): string {
  return company
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/(?:\s+(?:incorporated|inc|limited|ltd|corporation|corp|company|co|llc|plc|gmbh))+$/g, "")
    .trim();
}

export function companyNameMatches(storedCompany: string, displayedCompany: string): boolean {
  const stored = canonicalCompanyName(storedCompany);
  const displayed = canonicalCompanyName(displayedCompany);
  if (!stored || !displayed || displayed === "company") return false;
  return stored === displayed || (/(?:\.{3}|…)$/.test(displayedCompany.trim()) && stored.startsWith(displayed));
}

export function applicationsAtCompany(applications: Application[], company: string): Application[] {
  return applications.filter((application) =>
    !application.outreach &&
    application.status !== "Saved" &&
    companyNameMatches(application.company, company)
  );
}

export function isFollowUpDue(application: Application, todayISO: string): boolean {
  if (!application.nextActionDate) return false;
  if (application.status === "Rejected" || application.status === "Ghosted") return false;
  if (application.outreach?.status === "Lost") return false;
  return application.nextActionDate.slice(0, 10) <= todayISO;
}

export function applicationToClipboardText(application: Application): string {
  const compensation = application.compensation;
  const upwork = application.upwork;
  const outreach = application.outreach;
  return [
    `${application.role || (outreach ? "Untitled service" : "Untitled role")} at ${application.company || (outreach ? "Unknown business" : "Unknown company")}`,
    [
      `${outreach ? "Business" : "Company"}: ${application.company}`,
      `${outreach ? "Service" : "Role"}: ${application.role}`,
      `Status: ${outreach?.status ?? application.status}`,
      `Source: ${application.source}`,
      `${outreach ? "Website" : "Job URL"}: ${application.jobUrl}`,
      `${outreach ? "Date added" : "Date applied"}: ${localDateISO(application.dateApplied)}`,
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
    outreach
      ? [
          "Local outreach",
          outreach.contactName ? `Contact: ${outreach.contactName}` : "",
          outreach.contactMethod ? `Method: ${outreach.contactMethod}` : "",
          outreach.contactDetails ? `Contact details: ${outreach.contactDetails}` : "",
          outreach.contactedAt ? `First contacted: ${outreach.contactedAt.slice(0, 10)}` : ""
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
    // The same posting is reachable through a list URL that carries the id as a
    // query param and a detail URL that carries it in the path, so canonicalize
    // on the id itself: LinkedIn ?currentJobId= vs /jobs/view/<id>, Indeed &vjk=
    // vs /viewjob?jk=, Upwork /jobs/~id vs /nx/find-work/.../details/~id.
    const upworkId = parsed.hostname.endsWith("upwork.com") ? parsed.pathname.match(/~[0-9a-z]+/i)?.[0] : undefined;
    const jobId =
      parsed.searchParams.get("currentJobId") ||
      parsed.pathname.match(/\/jobs\/view\/(\d+)/)?.[1] ||
      parsed.searchParams.get("jk") ||
      parsed.searchParams.get("vjk") ||
      parsed.searchParams.get("jobKey") ||
      upworkId ||
      parsed.pathname.replace(/\/+$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${jobId}`;
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
