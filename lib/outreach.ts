import type { Application, ApplicationStatus, OutreachStatus } from "./schema";

export type OpportunityType = "jobs" | "upwork" | "outreach";

export function opportunityType(application: Application): OpportunityType {
  if (application.outreach) return "outreach";
  if (application.upwork) return "upwork";
  return "jobs";
}

export function opportunityStatus(application: Application): ApplicationStatus | OutreachStatus {
  return application.outreach?.status ?? application.status;
}

export function changeOutreachStatus(application: Application, status: OutreachStatus): Partial<Application> {
  if (!application.outreach) throw new Error("Application does not contain local outreach details.");
  const contactedAt = status !== "Lead" && !application.outreach.contactedAt
    ? new Date().toISOString()
    : application.outreach.contactedAt;
  return {
    outreach: { ...application.outreach, status, contactedAt }
  };
}

export function outreachSummary(applications: Application[]) {
  const leads = applications.filter((application) => application.outreach);
  const hasStatus = (...statuses: OutreachStatus[]) =>
    leads.filter((application) => statuses.includes(application.outreach!.status)).length;
  return {
    count: leads.length,
    contacted: leads.filter((application) => Boolean(application.outreach?.contactedAt)).length,
    replies: hasStatus("Replied", "Meeting", "Proposal", "Won"),
    meetings: hasStatus("Meeting", "Proposal", "Won"),
    proposals: hasStatus("Proposal", "Won"),
    wins: hasStatus("Won")
  };
}
