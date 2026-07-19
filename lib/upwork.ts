import type { Application, ApplicationStatus, UpworkProposalDetails, UpworkProposalStatus } from "./schema";

export const UPWORK_PROPOSAL_STATUSES: UpworkProposalStatus[] = [
  "Submitted",
  "Responded",
  "Interview",
  "Offered",
  "Hired",
  "Declined",
  "Withdrawn",
  "Archived"
];

const TRACKER_STATUS: Record<UpworkProposalStatus, ApplicationStatus> = {
  Submitted: "Applied",
  Responded: "Screen",
  Interview: "Interview",
  Offered: "Offer",
  Hired: "Offer",
  Declined: "Rejected",
  Withdrawn: "Rejected",
  Archived: "Ghosted"
};

export function changeUpworkStatus(application: Application, status: UpworkProposalStatus): Partial<Application> {
  if (!application.upwork) throw new Error("Application does not contain Upwork proposal details.");
  const now = new Date().toISOString();
  const events: Partial<UpworkProposalDetails> = {};
  if (["Responded", "Interview", "Offered", "Hired"].includes(status) && !application.upwork.respondedAt) events.respondedAt = now;
  if (status === "Interview" && !application.upwork.interviewedAt) events.interviewedAt = now;
  if (["Offered", "Hired"].includes(status) && !application.upwork.offeredAt) events.offeredAt = now;
  if (status === "Hired" && !application.upwork.hiredAt) events.hiredAt = now;
  return {
    status: TRACKER_STATUS[status],
    upwork: { ...application.upwork, ...events, status }
  };
}

export function upworkSummary(applications: Application[]) {
  const proposals = applications.filter((application) => application.upwork);
  const count = proposals.length;
  const countWith = (field: "respondedAt" | "interviewedAt" | "offeredAt" | "hiredAt") =>
    proposals.filter((application) => Boolean(application.upwork?.[field])).length;
  const actualConnects = proposals.reduce((total, application) =>
    total + (application.upwork?.baseConnects ?? 0) + (application.upwork?.boostCharged ?? 0), 0);
  return {
    count,
    actualConnects,
    responses: countWith("respondedAt"),
    interviews: countWith("interviewedAt"),
    offers: countWith("offeredAt"),
    hires: countWith("hiredAt")
  };
}

export function upworkRate(value: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((value / total) * 100)}%`;
}
