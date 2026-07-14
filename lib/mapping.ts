import Fuse from "fuse.js";
import { db } from "./db";
import { formatProfilePhone } from "./profileValues";
import { SYNONYMS } from "./synonyms";
import type { AnswerMemory, CanonicalField, FieldDescriptor, FieldFill, Profile } from "./schema";

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+ ]+/g, " ").replace(/\s+/g, " ").trim();
}

export function questionHash(question: string): string {
  let hash = 5381;
  const normalized = normalizeText(question);
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 33) ^ normalized.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

export function deterministicValue(field: FieldDescriptor, profile: Profile): FieldFill | undefined {
  const normalized = normalizeText(field.question);
  const canonical = Object.entries(SYNONYMS).find(([, patterns]) =>
    patterns.some((pattern) => normalized.includes(pattern))
  )?.[0] as CanonicalField | undefined;

  if (!canonical) return undefined;

  const raw = getProfileValue(profile, canonical);
  if (raw === "" || raw === undefined) return undefined;

  const value = coerceForField(field, raw);
  if (value === undefined) return undefined;

  return { id: field.id, value, source: "profile", confidence: 0.94 };
}

export async function memoryValue(field: FieldDescriptor): Promise<FieldFill | undefined> {
  const memories = await db.answerMemory.toArray();
  if (memories.length === 0) return undefined;

  const fuse = new Fuse(memories, {
    keys: ["questionText"],
    threshold: 0.28,
    ignoreLocation: true
  });
  const exact = memories.find((memory) => memory.questionHash === questionHash(field.question));
  const match = exact ?? fuse.search(field.question)[0]?.item;
  if (!match) return undefined;

  await db.answerMemory.update(match.id!, { lastUsed: new Date().toISOString() });
  return { id: field.id, value: match.answer, source: "memory", confidence: exact ? 1 : 0.82 };
}

export async function rememberAnswer(questionText: string, answer: string): Promise<void> {
  const questionHashValue = questionHash(questionText);
  const existing = await db.answerMemory.where("questionHash").equals(questionHashValue).first();
  const payload: AnswerMemory = {
    questionHash: questionHashValue,
    questionText,
    answer,
    lastUsed: new Date().toISOString(),
    editable: true
  };

  if (existing?.id) {
    await db.answerMemory.update(existing.id, payload);
    return;
  }
  await db.answerMemory.add(payload);
}

function getProfileValue(profile: Profile, key: CanonicalField): string | boolean | undefined {
  switch (key) {
    case "identity.firstName":
      return profile.identity.firstName;
    case "identity.middleName":
      return profile.identity.middleName;
    case "identity.lastName":
      return profile.identity.lastName;
    case "identity.email":
      return profile.identity.email;
    case "identity.phone":
      return formatProfilePhone(profile);
    case "identity.phoneCountryCode":
      return profile.identity.phoneCountryCode;
    case "identity.address.line1":
      return profile.identity.address.line1;
    case "identity.address.line2":
      return profile.identity.address.line2;
    case "identity.address.postalCode":
      return profile.identity.address.postalCode;
    case "identity.location.city":
      return profile.identity.location.city;
    case "identity.location.state":
      return profile.identity.location.state;
    case "identity.location.country":
      return profile.identity.location.country;
    case "identity.links.linkedin":
      return profile.identity.links.linkedin;
    case "identity.links.github":
      return profile.identity.links.github;
    case "identity.links.portfolio":
      return profile.identity.links.portfolio || profile.identity.links.website;
    case "workAuthorization.usAuthorized":
      return profile.workAuthorization.usAuthorized;
    case "workAuthorization.requiresSponsorship":
      return profile.workAuthorization.requiresSponsorship;
    case "workAuthorization.visaStatus":
      return profile.workAuthorization.visaStatus;
    case "workAuthorization.englishProficiency":
      return profile.workAuthorization.englishProficiency;
    case "applicationDefaults.referralSource":
      return profile.applicationDefaults.referralSource;
    case "applicationDefaults.referralDetails":
      return profile.applicationDefaults.referralDetails;
    case "applicationDefaults.employeeReferralName":
      return profile.applicationDefaults.employeeReferralName;
    case "applicationDefaults.needsRecruitmentAdjustments":
      return profile.applicationDefaults.needsRecruitmentAdjustments;
    case "applicationDefaults.recruitmentAdjustmentsDetails":
      return profile.applicationDefaults.recruitmentAdjustmentsDetails;
    case "applicationDefaults.previouslyEmployedByFitch":
      return profile.applicationDefaults.previouslyEmployedByFitch;
    case "applicationDefaults.currentEmployer":
      return profile.applicationDefaults.currentEmployer || profile.experience[0]?.company;
    case "applicationDefaults.currentTitle":
      return profile.applicationDefaults.currentTitle || profile.experience[0]?.title;
    case "applicationDefaults.currentSalary":
      return profile.applicationDefaults.currentSalary;
    case "applicationDefaults.desiredSalary":
      return profile.applicationDefaults.desiredSalary;
    case "applicationDefaults.salaryCurrency":
      return profile.applicationDefaults.salaryCurrency;
    case "applicationDefaults.profileVisibility":
      return profile.applicationDefaults.profileVisibility;
    case "applicationDefaults.jobNotifications":
      return profile.applicationDefaults.jobNotifications;
    case "demographics.gender":
      return profile.demographics.gender;
    case "demographics.race":
      return profile.demographics.race;
    case "demographics.veteran":
      return profile.demographics.veteran;
    case "demographics.disability":
      return profile.demographics.disability;
  }
}

function coerceForField(field: FieldDescriptor, raw: string | boolean): string | boolean | undefined {
  if (field.type === "checkbox") return Boolean(raw);
  if (field.options?.length) {
    const normalizedRaw = normalizeText(String(raw));
    const option = field.options.find((candidate) => normalizeText(candidate) === normalizedRaw)
      ?? field.options.find((candidate) => normalizeText(candidate).includes(normalizedRaw));
    if (option) return option;

    if (typeof raw === "boolean") {
      return findBooleanOption(field.options, raw);
    }
  }
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return raw;
}

function findBooleanOption(options: string[], value: boolean): string | undefined {
  const yes = ["yes", "true", "i am", "authorized"];
  const no = ["no", "false", "i am not", "not authorized"];
  const patterns = value ? yes : no;
  return options.find((option) => patterns.some((pattern) => normalizeText(option).includes(pattern)));
}
