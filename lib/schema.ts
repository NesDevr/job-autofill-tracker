export type CanonicalField =
  | "identity.firstName"
  | "identity.lastName"
  | "identity.email"
  | "identity.phone"
  | "identity.location.city"
  | "identity.location.state"
  | "identity.location.country"
  | "identity.links.linkedin"
  | "identity.links.github"
  | "identity.links.portfolio"
  | "workAuthorization.usAuthorized"
  | "workAuthorization.requiresSponsorship"
  | "workAuthorization.englishProficiency";

export type FieldType = "text" | "textarea" | "select" | "radio" | "checkbox" | "file";

export type FieldDescriptor = {
  id: string;
  question: string;
  type: FieldType;
  options?: string[];
  value?: string;
};

export type FieldFill = {
  id: string;
  value: string | boolean;
  source: "profile" | "memory" | "ai" | "skip";
  confidence: number;
};

export type Experience = {
  title: string;
  company: string;
  start: string;
  end: string;
  highlights: string[];
  stack: string[];
};

export type SkillFact = {
  years: number;
  note: string;
  services?: string[];
};

export type AnswerMemory = {
  id?: number;
  questionHash: string;
  questionText: string;
  answer: string;
  lastUsed: string;
  editable: boolean;
};

export type ApplicationStatus =
  | "Saved"
  | "Applied"
  | "Screen"
  | "Interview"
  | "Offer"
  | "Rejected"
  | "Ghosted";

export type CompensationPeriod = "year" | "month" | "hour" | "one-time" | "";
export type CompensationCurrency = "MXN" | "USD" | "EUR" | "";

export type Compensation = {
  text: string;
  currency: CompensationCurrency;
  min?: number | null;
  max?: number | null;
  period: CompensationPeriod;
};

export type ThemeMode = "light" | "dark";

export type Application = {
  id?: number;
  company: string;
  role: string;
  jobUrl: string;
  source: string;
  dateApplied: string;
  status: ApplicationStatus;
  location?: string;
  workMode?: "Remote" | "Hybrid" | "On-site" | "";
  compensation?: Compensation;
  jobDescription?: string;
  resumeVersion?: string;
  answersUsed: Array<{ question: string; answer: string }>;
  notes: string;
  nextActionDate?: string;
};

export type PendingApplication = {
  id: string;
  application: Application;
  createdAt: string;
};

export type DashboardLaunch = {
  tab: "tracker";
  pendingId?: string;
  createdAt: string;
};

export type Profile = {
  identity: {
    firstName: string;
    lastName: string;
    preferredName: string;
    email: string;
    phone: string;
    phoneCountryCode: string;
    location: {
      city: string;
      state: string;
      country: string;
      willingToRelocate: boolean;
    };
    links: {
      linkedin: string;
      github: string;
      portfolio: string;
      website: string;
    };
  };
  workAuthorization: {
    usAuthorized: boolean;
    requiresSponsorship: boolean;
    eligibleCountries: string[];
    timezonesComfortable: string[];
    englishProficiency: string;
  };
  experience: Experience[];
  skills: Record<string, SkillFact>;
  education: Array<{ degree: string; school: string; year: string }>;
  demographics: {
    gender: string;
    race: string;
    veteran: string;
    disability: string;
  };
  resumeFileRef: string;
};

export type Settings = {
  aiEnabled: boolean;
  provider: "openai";
  apiKey: string;
  model: string;
  theme: ThemeMode;
  enabledSites: {
    greenhouse: boolean;
    lever: boolean;
    ashby: boolean;
    linkedin: boolean;
  };
};

export type MapFieldsRequest = {
  kind: "MAP_FIELDS";
  fields: FieldDescriptor[];
  jobDescription: string;
  page: PageContext;
};

export type LogApplicationRequest = {
  kind: "LOG_APPLICATION";
  application: Application;
};

export type QueuePendingApplicationRequest = {
  kind: "QUEUE_PENDING_APPLICATION";
  pending: PendingApplication;
};

export type RemovePendingApplicationRequest = {
  kind: "REMOVE_PENDING_APPLICATION";
  id: string;
};

export type OpenTrackerPasteRequest = {
  kind: "OPEN_TRACKER_PASTE";
  pending: PendingApplication;
};

export type AutofillCurrentFormRequest = {
  kind: "AUTOFILL_CURRENT_FORM";
};

export type TrackCurrentApplicationRequest = {
  kind: "TRACK_CURRENT_APPLICATION";
};

export type PageContext = {
  url: string;
  title: string;
  source: string;
  company: string;
  role: string;
};

export type ExtensionMessage =
  | MapFieldsRequest
  | LogApplicationRequest
  | QueuePendingApplicationRequest
  | RemovePendingApplicationRequest
  | OpenTrackerPasteRequest
  | AutofillCurrentFormRequest
  | TrackCurrentApplicationRequest;

export const EMPTY_PROFILE: Profile = {
  identity: {
    firstName: "",
    lastName: "",
    preferredName: "",
    email: "",
    phone: "",
    phoneCountryCode: "+52",
    location: {
      city: "",
      state: "Tamaulipas",
      country: "Mexico",
      willingToRelocate: false
    },
    links: {
      linkedin: "",
      github: "",
      portfolio: "",
      website: ""
    }
  },
  workAuthorization: {
    usAuthorized: false,
    requiresSponsorship: true,
    eligibleCountries: ["Mexico"],
    timezonesComfortable: ["EST", "CST", "PST"],
    englishProficiency: "Professional (C1) - fluent speaking, writing, reading"
  },
  experience: [],
  skills: {},
  education: [],
  demographics: {
    gender: "",
    race: "",
    veteran: "",
    disability: ""
  },
  resumeFileRef: ""
};

export const DEFAULT_SETTINGS: Settings = {
  aiEnabled: false,
  provider: "openai",
  apiKey: "",
  model: "gpt-5.4-mini",
  theme: "light",
  enabledSites: {
    greenhouse: true,
    lever: true,
    ashby: true,
    linkedin: true
  }
};
