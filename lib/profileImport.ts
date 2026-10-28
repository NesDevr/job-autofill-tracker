import type { Experience, PersonalProject, Profile, SkillFact } from "./schema";
import { normalizeProfilePhone } from "./profileValues";

export const MAX_PROFILE_JSON_BYTES = 1_000_000;

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

type JsonObject = Record<string, unknown>;

export type ProfileImportPreview = {
  profile: Profile;
  summary: {
    name: string;
    currentRole: string;
    experienceCount: number;
    projectCount: number;
    skillCount: number;
  };
};

export function parseProfileJson(text: string, currentProfile: Profile): ProfileImportPreview {
  if (new TextEncoder().encode(text).byteLength > MAX_PROFILE_JSON_BYTES) {
    throw new Error("Profile JSON is larger than 1 MB.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Profile JSON is not valid JSON.");
  }

  rejectForbiddenKeys(parsed, "$", new Set());
  const root = objectAt(parsed, "$", profileKeys);

  const identity = objectAt(root.identity, "identity", identityKeys);
  const address = objectAt(identity.address, "identity.address", addressKeys);
  const location = objectAt(identity.location, "identity.location", locationKeys);
  const links = objectAt(identity.links, "identity.links", linkKeys);
  const workAuthorization = objectAt(root.workAuthorization, "workAuthorization", workAuthorizationKeys);
  const demographics = objectAt(root.demographics, "demographics", demographicsKeys);
  const applicationDefaults = objectAt(root.applicationDefaults, "applicationDefaults", applicationDefaultKeys);

  const profile: Profile = {
    identity: {
      firstName: stringAt(identity.firstName, "identity.firstName"),
      middleName: stringAt(identity.middleName, "identity.middleName"),
      lastName: stringAt(identity.lastName, "identity.lastName"),
      preferredName: stringAt(identity.preferredName, "identity.preferredName"),
      email: stringAt(identity.email, "identity.email"),
      phone: stringAt(identity.phone, "identity.phone"),
      phoneCountryCode: stringAt(identity.phoneCountryCode, "identity.phoneCountryCode"),
      address: {
        line1: stringAt(address.line1, "identity.address.line1"),
        line2: stringAt(address.line2, "identity.address.line2"),
        postalCode: stringAt(address.postalCode, "identity.address.postalCode")
      },
      location: {
        city: stringAt(location.city, "identity.location.city"),
        state: stringAt(location.state, "identity.location.state"),
        country: stringAt(location.country, "identity.location.country"),
        willingToRelocate: booleanAt(location.willingToRelocate, "identity.location.willingToRelocate")
      },
      links: {
        linkedin: urlAt(links.linkedin, "identity.links.linkedin"),
        github: urlAt(links.github, "identity.links.github"),
        portfolio: urlAt(links.portfolio, "identity.links.portfolio"),
        website: urlAt(links.website, "identity.links.website")
      }
    },
    workAuthorization: {
      usAuthorized: booleanAt(workAuthorization.usAuthorized, "workAuthorization.usAuthorized"),
      requiresSponsorship: booleanAt(workAuthorization.requiresSponsorship, "workAuthorization.requiresSponsorship"),
      visaStatus: stringAt(workAuthorization.visaStatus, "workAuthorization.visaStatus"),
      eligibleCountries: stringArrayAt(workAuthorization.eligibleCountries, "workAuthorization.eligibleCountries", 50),
      timezonesComfortable: stringArrayAt(workAuthorization.timezonesComfortable, "workAuthorization.timezonesComfortable", 50),
      englishProficiency: stringAt(workAuthorization.englishProficiency, "workAuthorization.englishProficiency")
    },
    experience: arrayAt(root.experience, "experience", 100).map((value, index) => experienceAt(value, `experience[${index}]`)),
    personalProjects: arrayAt(root.personalProjects, "personalProjects", 200).map((value, index) => projectAt(value, `personalProjects[${index}]`)),
    additionalKnowledge: stringAt(root.additionalKnowledge, "additionalKnowledge", 100_000),
    skills: skillsAt(root.skills, "skills"),
    education: arrayAt(root.education, "education", 50).map((value, index) => {
      const path = `education[${index}]`;
      const item = objectAt(value, path, educationKeys);
      return {
        degree: stringAt(item.degree, `${path}.degree`),
        school: stringAt(item.school, `${path}.school`),
        year: stringAt(item.year, `${path}.year`)
      };
    }),
    demographics: {
      gender: stringAt(demographics.gender, "demographics.gender"),
      race: stringAt(demographics.race, "demographics.race"),
      veteran: stringAt(demographics.veteran, "demographics.veteran"),
      disability: stringAt(demographics.disability, "demographics.disability")
    },
    applicationDefaults: {
      referralSource: stringAt(applicationDefaults.referralSource, "applicationDefaults.referralSource"),
      referralDetails: stringAt(applicationDefaults.referralDetails, "applicationDefaults.referralDetails"),
      employeeReferralName: stringAt(applicationDefaults.employeeReferralName, "applicationDefaults.employeeReferralName"),
      needsRecruitmentAdjustments: booleanAt(applicationDefaults.needsRecruitmentAdjustments, "applicationDefaults.needsRecruitmentAdjustments"),
      recruitmentAdjustmentsDetails: stringAt(applicationDefaults.recruitmentAdjustmentsDetails, "applicationDefaults.recruitmentAdjustmentsDetails"),
      previouslyEmployedByFitch: booleanAt(applicationDefaults.previouslyEmployedByFitch, "applicationDefaults.previouslyEmployedByFitch"),
      currentEmployer: stringAt(applicationDefaults.currentEmployer, "applicationDefaults.currentEmployer"),
      currentTitle: stringAt(applicationDefaults.currentTitle, "applicationDefaults.currentTitle"),
      currentSalary: stringAt(applicationDefaults.currentSalary, "applicationDefaults.currentSalary"),
      desiredSalary: stringAt(applicationDefaults.desiredSalary, "applicationDefaults.desiredSalary"),
      salaryCurrency: stringAt(applicationDefaults.salaryCurrency, "applicationDefaults.salaryCurrency"),
      profileVisibility: stringAt(applicationDefaults.profileVisibility, "applicationDefaults.profileVisibility"),
      jobNotifications: booleanAt(applicationDefaults.jobNotifications, "applicationDefaults.jobNotifications")
    },
    resumeFileRef: stringAt(root.resumeFileRef, "resumeFileRef"),
    resumeFile: currentProfile.resumeFile,
    coverLetterFile: currentProfile.coverLetterFile
  };

  const normalized = normalizeProfilePhone(profile);
  const name = `${normalized.identity.firstName} ${normalized.identity.lastName}`.trim() || "Unnamed profile";
  const currentExperience = normalized.experience.find((item) => item.end.trim().toLowerCase() === "present") ?? normalized.experience[0];

  return {
    profile: normalized,
    summary: {
      name,
      currentRole: currentExperience ? `${currentExperience.title} at ${currentExperience.company}` : "No current role",
      experienceCount: normalized.experience.length,
      projectCount: normalized.personalProjects.length,
      skillCount: Object.keys(normalized.skills).length
    }
  };
}

function experienceAt(value: unknown, path: string): Experience {
  const item = objectAt(value, path, experienceKeys);
  return {
    title: stringAt(item.title, `${path}.title`),
    company: stringAt(item.company, `${path}.company`),
    start: stringAt(item.start, `${path}.start`),
    end: stringAt(item.end, `${path}.end`),
    highlights: stringArrayAt(item.highlights, `${path}.highlights`, 100),
    stack: stringArrayAt(item.stack, `${path}.stack`, 100)
  };
}

function projectAt(value: unknown, path: string): PersonalProject {
  const item = objectAt(value, path, projectKeys);
  return {
    name: stringAt(item.name, `${path}.name`),
    description: stringAt(item.description, `${path}.description`, 20_000),
    role: stringAt(item.role, `${path}.role`),
    start: stringAt(item.start, `${path}.start`),
    end: stringAt(item.end, `${path}.end`),
    highlights: stringArrayAt(item.highlights, `${path}.highlights`, 100),
    stack: stringArrayAt(item.stack, `${path}.stack`, 100),
    url: urlAt(item.url, `${path}.url`),
    repository: urlAt(item.repository, `${path}.repository`)
  };
}

function skillsAt(value: unknown, path: string): Record<string, SkillFact> {
  const object = objectAt(value, path);
  const entries = Object.entries(object);
  if (entries.length > 500) throw new Error(`${path} has too many entries.`);
  const result: Record<string, SkillFact> = {};
  for (const [name, rawFact] of entries) {
    if (!name.trim() || name.length > 120) throw new Error(`${path} contains an invalid skill name.`);
    const factPath = `${path}.${name}`;
    const fact = objectAt(rawFact, factPath, skillFactKeys, ["years", "note"]);
    const years = numberAt(fact.years, `${factPath}.years`);
    if (years < 0 || years > 80) throw new Error(`${factPath}.years must be between 0 and 80.`);
    result[name] = {
      years,
      note: stringAt(fact.note, `${factPath}.note`, 10_000),
      services: fact.services === undefined ? undefined : stringArrayAt(fact.services, `${factPath}.services`, 100)
    };
  }
  return result;
}

function rejectForbiddenKeys(value: unknown, path: string, seen: Set<object>): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new Error(`Circular data is not allowed at ${path}.`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`Unsafe key "${key}" is not allowed at ${path}.`);
    rejectForbiddenKeys(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function objectAt(value: unknown, path: string, allowedKeys?: readonly string[], requiredKeys = allowedKeys): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  const object = value as JsonObject;
  if (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null) {
    throw new Error(`${path} must be a plain object.`);
  }
  if (allowedKeys) {
    const unknown = Object.keys(object).filter((key) => !allowedKeys.includes(key));
    if (unknown.length) throw new Error(`${path} contains unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
    const missing = requiredKeys?.filter((key) => !(key in object)) ?? [];
    if (missing.length) throw new Error(`${path} is missing field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
  }
  return object;
}

function arrayAt(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > maximum) throw new Error(`${path} has too many entries.`);
  return value;
}

function stringArrayAt(value: unknown, path: string, maximum: number): string[] {
  return arrayAt(value, path, maximum).map((item, index) => stringAt(item, `${path}[${index}]`));
}

function stringAt(value: unknown, path: string, maximum = 20_000): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  if (value.length > maximum) throw new Error(`${path} is too long.`);
  return value;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be true or false.`);
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
  return value;
}

function urlAt(value: unknown, path: string): string {
  const url = stringAt(value, path, 2_000);
  if (!url) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${path} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error(`${path} must use http or https.`);
  return url;
}

const profileKeys = ["identity", "workAuthorization", "experience", "personalProjects", "additionalKnowledge", "skills", "education", "demographics", "applicationDefaults", "resumeFileRef"] as const;
const identityKeys = ["firstName", "middleName", "lastName", "preferredName", "email", "phone", "phoneCountryCode", "address", "location", "links"] as const;
const addressKeys = ["line1", "line2", "postalCode"] as const;
const locationKeys = ["city", "state", "country", "willingToRelocate"] as const;
const linkKeys = ["linkedin", "github", "portfolio", "website"] as const;
const workAuthorizationKeys = ["usAuthorized", "requiresSponsorship", "visaStatus", "eligibleCountries", "timezonesComfortable", "englishProficiency"] as const;
const experienceKeys = ["title", "company", "start", "end", "highlights", "stack"] as const;
const projectKeys = ["name", "description", "role", "start", "end", "highlights", "stack", "url", "repository"] as const;
const skillFactKeys = ["years", "note", "services"] as const;
const educationKeys = ["degree", "school", "year"] as const;
const demographicsKeys = ["gender", "race", "veteran", "disability"] as const;
const applicationDefaultKeys = ["referralSource", "referralDetails", "employeeReferralName", "needsRecruitmentAdjustments", "recruitmentAdjustmentsDetails", "previouslyEmployedByFitch", "currentEmployer", "currentTitle", "currentSalary", "desiredSalary", "salaryCurrency", "profileVisibility", "jobNotifications"] as const;
