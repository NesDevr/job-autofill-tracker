import type { AnswerMemory, Application, Profile } from "./schema";

function isoDaysFromToday(days: number, hour = 10): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export const DEMO_PROFILE: Profile = {
  identity: {
    firstName: "Maya",
    middleName: "",
    lastName: "Chen",
    preferredName: "Maya",
    email: "maya.chen@example.com",
    phone: "555 014 7281",
    phoneCountryCode: "+1",
    address: { line1: "42 Market Street", line2: "Apt 7", postalCode: "94105" },
    location: { city: "San Francisco", state: "California", country: "United States", willingToRelocate: true },
    links: {
      linkedin: "https://linkedin.com/in/mayachen-demo",
      github: "https://github.com/mayachen-demo",
      portfolio: "https://maya-chen.example.com",
      website: ""
    }
  },
  workAuthorization: {
    usAuthorized: true,
    requiresSponsorship: false,
    visaStatus: "US citizen",
    eligibleCountries: ["United States"],
    timezonesComfortable: ["PST", "MST", "CST", "EST"],
    englishProficiency: "Native"
  },
  experience: [
    {
      title: "Senior Product Engineer",
      company: "Northstar Labs",
      start: "2022-03",
      end: "Present",
      highlights: ["Led a workflow redesign that reduced task completion time by 34%", "Mentored four engineers across two product squads"],
      stack: ["TypeScript", "React", "Node.js", "PostgreSQL"]
    },
    {
      title: "Software Engineer",
      company: "Juniper Works",
      start: "2019-06",
      end: "2022-02",
      highlights: ["Built customer analytics used by 60+ enterprise teams"],
      stack: ["React", "Python", "AWS"]
    }
  ],
  personalProjects: [
    {
      name: "Trailhead",
      description: "An open-source career planning workspace.",
      role: "Creator",
      start: "2023-01",
      end: "Present",
      highlights: ["Reached 1,200 monthly active users"],
      stack: ["Next.js", "Supabase"],
      url: "https://trailhead-demo.example.com",
      repository: "https://github.com/mayachen-demo/trailhead"
    }
  ],
  additionalKnowledge: "Enjoys turning ambiguous customer problems into small, measurable product experiments. Comfortable leading discovery, implementation, and launch.",
  skills: {
    TypeScript: { years: 7, note: "Production web applications and developer tooling" },
    React: { years: 7, note: "Design systems, dashboards, and performance work" },
    "Node.js": { years: 6, note: "APIs, queues, and integrations" },
    PostgreSQL: { years: 5, note: "Schema design and query optimization" },
    Python: { years: 4, note: "Automation and data workflows" }
  },
  education: [{ degree: "B.S. Computer Science", school: "Pacific State University", year: "2019" }],
  demographics: { gender: "Prefer not to say", race: "Prefer not to say", veteran: "No", disability: "Prefer not to say" },
  applicationDefaults: {
    referralSource: "Company careers page",
    referralDetails: "",
    employeeReferralName: "",
    needsRecruitmentAdjustments: false,
    recruitmentAdjustmentsDetails: "",
    previouslyEmployedByFitch: false,
    currentEmployer: "Northstar Labs",
    currentTitle: "Senior Product Engineer",
    currentSalary: "",
    desiredSalary: "165000",
    salaryCurrency: "USD",
    profileVisibility: "Only for the roles that I directly apply to",
    jobNotifications: true
  },
  resumeFileRef: "maya-chen-resume.pdf"
};

export function createDemoApplications(): Application[] {
  return [
    { id: 9001, company: "Lumen", role: "Staff Product Engineer", jobUrl: "https://example.com/jobs/lumen", source: "LinkedIn", dateApplied: isoDaysFromToday(0, 9), status: "Applied", location: "Remote — US", workMode: "Remote", compensation: { text: "$175k–$205k", currency: "USD", min: 175000, max: 205000, period: "year" }, answersUsed: [], notes: "Strong product engineering fit. Follow up with the hiring manager.", nextActionDate: isoDaysFromToday(3) },
    { id: 9002, company: "Arcwell", role: "Senior Frontend Engineer", jobUrl: "https://example.com/jobs/arcwell", source: "Referral", dateApplied: isoDaysFromToday(-1, 15), status: "Screen", location: "New York, NY", workMode: "Hybrid", compensation: { text: "$160k–$190k", currency: "USD", min: 160000, max: 190000, period: "year" }, answersUsed: [{ question: "Why Arcwell?", answer: "I’m drawn to Arcwell’s focus on making complex financial workflows feel approachable." }], notes: "Recruiter call went well.", nextActionDate: isoDaysFromToday(1) },
    { id: 9003, company: "Fieldnote", role: "Product Engineer", jobUrl: "https://example.com/jobs/fieldnote", source: "Wellfound", dateApplied: isoDaysFromToday(-3), status: "Interview", location: "San Francisco, CA", workMode: "Hybrid", compensation: { text: "$170k–$195k + equity", currency: "USD", min: 170000, max: 195000, period: "year" }, answersUsed: [], notes: "Prepare system design story and Trailhead walkthrough.", nextActionDate: isoDaysFromToday(0, 16) },
    { id: 9004, company: "Morrow", role: "Founding Engineer", jobUrl: "https://example.com/jobs/morrow", source: "Company site", dateApplied: isoDaysFromToday(-5), status: "Offer", location: "Remote", workMode: "Remote", compensation: { text: "$185k + 0.4% equity", currency: "USD", min: 185000, period: "year" }, answersUsed: [], notes: "Offer review scheduled for Friday.", nextActionDate: isoDaysFromToday(2) },
    { id: 9005, company: "Parcel", role: "Senior Software Engineer", jobUrl: "https://example.com/jobs/parcel", source: "LinkedIn", dateApplied: isoDaysFromToday(-8), status: "Saved", location: "Austin, TX", workMode: "Remote", compensation: { text: "$155k–$180k", currency: "USD", min: 155000, max: 180000, period: "year" }, answersUsed: [], notes: "Tailor résumé toward platform work." },
    { id: 9006, company: "Kindred Health", role: "Frontend Platform Engineer", jobUrl: "https://example.com/jobs/kindred", source: "Otta", dateApplied: isoDaysFromToday(-12), status: "Rejected", location: "Denver, CO", workMode: "Remote", answersUsed: [], notes: "Good conversation; role required deeper mobile experience." },
    { id: 9007, company: "Daybreak", role: "Full-stack Engineer", jobUrl: "https://example.com/jobs/daybreak", source: "Referral", dateApplied: isoDaysFromToday(-18), status: "Ghosted", location: "Seattle, WA", workMode: "Hybrid", answersUsed: [], notes: "Sent one follow-up after the technical screen." }
  ];
}

export function createDemoMemories(): AnswerMemory[] {
  return [
    { id: 9101, questionHash: "demo-1", questionText: "Why are you interested in this role?", answer: "I’m excited by roles where engineers partner closely with design and customers, then carry ideas from discovery through launch.", lastUsed: isoDaysFromToday(-1), editable: true },
    { id: 9102, questionHash: "demo-2", questionText: "Describe a project you are proud of.", answer: "I led a workflow redesign that reduced task completion time by 34% while making the underlying system easier for other teams to extend.", lastUsed: isoDaysFromToday(-3), editable: true },
    { id: 9103, questionHash: "demo-3", questionText: "What are your salary expectations?", answer: "I’m targeting a base salary in the $160,000–$190,000 range, depending on the role’s scope and total compensation.", lastUsed: isoDaysFromToday(-6), editable: true },
    { id: 9104, questionHash: "demo-4", questionText: "Are you authorized to work in the United States?", answer: "Yes, I am authorized to work in the United States without sponsorship.", lastUsed: isoDaysFromToday(-9), editable: true }
  ];
}
