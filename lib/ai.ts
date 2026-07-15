import { answerHasPlaceholder, rememberAnswer } from "./mapping";
import { normalizeCompensationCurrency } from "./compensation";
import { normalizeProfilePhone } from "./profileValues";
import { EMPTY_PROFILE, type Application, type Compensation, type FieldDescriptor, type FieldFill, type Profile, type Settings } from "./schema";

type OpenAiOutputContent = {
  type: string;
  text?: string;
  refusal?: string;
};

type OpenAiResponse = {
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
  output?: Array<{
    type: string;
    content?: OpenAiOutputContent[];
  }>;
  output_text?: string;
};

type ProfileDraft = Omit<Profile, "skills"> & {
  skills: Array<{
    name: string;
    years: number;
    note: string;
    services: string[];
  }>;
};

type JobPostingDraft = Pick<Application, "company" | "role" | "location" | "workMode" | "compensation" | "jobDescription" | "source" | "jobUrl">;
type JobPostingExtraction = Omit<JobPostingDraft, "jobDescription">;

const answerSchema = {
  type: "object",
  additionalProperties: { type: "string" }
};

const singleAnswerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: { type: "string" }
  }
};

const naturalAnswerInstructions =
  "Answer job-application questions in first person using only the candidate facts provided. Sound like a normal, relaxed professional speaking plainly—not a résumé, cover letter, sales pitch, or formal template. Answer the exact question directly. Default to 2–5 short sentences and under 90 words; use more only when the question explicitly asks for detail. Use contractions when natural. Include only the strongest relevant details instead of listing everything. Avoid canned introductions, conclusions, headings, bullet points, corporate clichés, inflated claims, and overly polished wording. Never write TODO, placeholders, bracketed notes, or mention missing profile data. If a fact is unknown, omit it. If no relevant experience is provided, say plainly that you do not have direct experience yet and stop. Never invent tools, employers, years, credentials, metrics, locations, authorization, salary, or availability.";

const profileSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "identity",
    "workAuthorization",
    "experience",
    "personalProjects",
    "additionalKnowledge",
    "skills",
    "education",
    "demographics",
    "applicationDefaults",
    "resumeFileRef"
  ],
  properties: {
    identity: {
      type: "object",
      additionalProperties: false,
      required: ["firstName", "middleName", "lastName", "preferredName", "email", "phone", "phoneCountryCode", "address", "location", "links"],
      properties: {
        firstName: { type: "string" },
        middleName: { type: "string" },
        lastName: { type: "string" },
        preferredName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        phoneCountryCode: { type: "string" },
        address: {
          type: "object",
          additionalProperties: false,
          required: ["line1", "line2", "postalCode"],
          properties: {
            line1: { type: "string" },
            line2: { type: "string" },
            postalCode: { type: "string" }
          }
        },
        location: {
          type: "object",
          additionalProperties: false,
          required: ["city", "state", "country", "willingToRelocate"],
          properties: {
            city: { type: "string" },
            state: { type: "string" },
            country: { type: "string" },
            willingToRelocate: { type: "boolean" }
          }
        },
        links: {
          type: "object",
          additionalProperties: false,
          required: ["linkedin", "github", "portfolio", "website"],
          properties: {
            linkedin: { type: "string" },
            github: { type: "string" },
            portfolio: { type: "string" },
            website: { type: "string" }
          }
        }
      }
    },
    workAuthorization: {
      type: "object",
      additionalProperties: false,
      required: ["usAuthorized", "requiresSponsorship", "visaStatus", "eligibleCountries", "timezonesComfortable", "englishProficiency"],
      properties: {
        usAuthorized: { type: "boolean" },
        requiresSponsorship: { type: "boolean" },
        visaStatus: { type: "string" },
        eligibleCountries: { type: "array", items: { type: "string" } },
        timezonesComfortable: { type: "array", items: { type: "string" } },
        englishProficiency: { type: "string" }
      }
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "company", "start", "end", "highlights", "stack"],
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          highlights: { type: "array", items: { type: "string" } },
          stack: { type: "array", items: { type: "string" } }
        }
      }
    },
    personalProjects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "role", "start", "end", "highlights", "stack", "url", "repository"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          role: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          highlights: { type: "array", items: { type: "string" } },
          stack: { type: "array", items: { type: "string" } },
          url: { type: "string" },
          repository: { type: "string" }
        }
      }
    },
    additionalKnowledge: { type: "string" },
    skills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "years", "note", "services"],
        properties: {
          name: { type: "string" },
          years: { type: "number" },
          note: { type: "string" },
          services: { type: "array", items: { type: "string" } }
        }
      }
    },
    education: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["degree", "school", "year"],
        properties: {
          degree: { type: "string" },
          school: { type: "string" },
          year: { type: "string" }
        }
      }
    },
    demographics: {
      type: "object",
      additionalProperties: false,
      required: ["gender", "race", "veteran", "disability"],
      properties: {
        gender: { type: "string" },
        race: { type: "string" },
        veteran: { type: "string" },
        disability: { type: "string" }
      }
    },
    applicationDefaults: {
      type: "object",
      additionalProperties: false,
      required: [
        "referralSource",
        "referralDetails",
        "employeeReferralName",
        "needsRecruitmentAdjustments",
        "recruitmentAdjustmentsDetails",
        "previouslyEmployedByFitch",
        "currentEmployer",
        "currentTitle",
        "currentSalary",
        "desiredSalary",
        "salaryCurrency",
        "profileVisibility",
        "jobNotifications"
      ],
      properties: {
        referralSource: { type: "string" },
        referralDetails: { type: "string" },
        employeeReferralName: { type: "string" },
        needsRecruitmentAdjustments: { type: "boolean" },
        recruitmentAdjustmentsDetails: { type: "string" },
        previouslyEmployedByFitch: { type: "boolean" },
        currentEmployer: { type: "string" },
        currentTitle: { type: "string" },
        currentSalary: { type: "string" },
        desiredSalary: { type: "string" },
        salaryCurrency: { type: "string" },
        profileVisibility: { type: "string" },
        jobNotifications: { type: "boolean" }
      }
    },
    resumeFileRef: { type: "string" }
  }
};

const jobPostingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["company", "role", "location", "workMode", "compensation", "source", "jobUrl"],
  properties: {
    company: { type: "string" },
    role: { type: "string" },
    location: { type: "string" },
    workMode: { type: "string", enum: ["Remote", "Hybrid", "On-site", ""] },
    compensation: {
      type: "object",
      additionalProperties: false,
      required: ["text", "currency", "min", "max", "period"],
      properties: {
        text: { type: "string" },
        currency: { type: "string", enum: ["MXN", "USD", "EUR", ""] },
        min: { type: ["number", "null"] },
        max: { type: ["number", "null"] },
        period: { type: "string", enum: ["year", "month", "hour", "one-time", ""] }
      }
    },
    source: { type: "string" },
    jobUrl: { type: "string" }
  }
};

export async function draftAnswers(
  fields: FieldDescriptor[],
  profile: Profile,
  settings: Settings,
  jobDescription: string
): Promise<FieldFill[]> {
  if (!settings.aiEnabled || !settings.apiKey || fields.length === 0) return [];

  const questions = fields.map((field, index) => ({
    id: String(index + 1),
    fieldId: field.id,
    type: field.type,
    question: field.question,
    options: field.options
  }));

  const text = await createOpenAiJson(settings, {
    instructions: naturalAnswerInstructions,
    input: [
      {
        role: "user",
        content: JSON.stringify({
          candidateFacts: profileFactsForAi(profile),
          jobDescription,
          questions: questions.map(({ id, type, question, options }) => ({ id, type, question, options })),
          returnShape: { "1": "answer for question 1" }
        })
      }
    ],
    schemaName: "job_application_answers",
    schema: answerSchema,
    maxOutputTokens: 1800
  });

  const parsed = JSON.parse(text) as Record<string, string>;
  const fills: FieldFill[] = [];
  for (const question of questions) {
    const value = parsed[question.id];
    if (!value || answerHasPlaceholder(value)) continue;
    fills.push({ id: question.fieldId, value, source: "ai", confidence: 0.7 });
    await rememberAnswer(question.question, value);
  }
  return fills;
}

export async function draftSingleAnswer(
  question: string,
  profile: Profile,
  settings: Settings
): Promise<string> {
  if (!settings.apiKey) throw new Error("OpenAI API key is required before drafting an answer.");
  if (!question.trim()) throw new Error("Paste a question first.");

  const text = await createOpenAiJson(settings, {
    instructions: `${naturalAnswerInstructions} Return only the answer text.`,
    input: [
      {
        role: "user",
        content: JSON.stringify({
          candidateFacts: profileFactsForAi(profile),
          question: question.trim()
        })
      }
    ],
    schemaName: "single_application_answer",
    schema: singleAnswerSchema,
    maxOutputTokens: 700
  });

  const parsed = JSON.parse(text) as { answer: string };
  if (answerHasPlaceholder(parsed.answer)) throw new Error("AI returned a placeholder instead of a usable answer.");
  await rememberAnswer(question, parsed.answer);
  return parsed.answer;
}

export async function importProfileFromCv(
  fileName: string,
  fileDataUrl: string,
  currentProfile: Profile,
  settings: Settings
): Promise<Profile> {
  if (!settings.apiKey) throw new Error("OpenAI API key is required before importing a CV.");
  const profileFacts = profileFactsForAi(currentProfile);

  const text = await createOpenAiJson(settings, {
    instructions:
      "Extract a candidate profile from the attached CV PDF. Use only facts present in the CV. Preserve existing profile values when the CV does not provide a value. Use empty strings, empty arrays, or false only when neither the CV nor the existing profile provides a value. Do not infer demographics or application defaults; preserve those existing values exactly.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              existingProfile: profileFacts,
              targetShape:
                "Return a complete profile draft. Skills must be an array with name, years, note, and services. Keep personal projects separate from employment experience.",
              resumeFileRef: fileName
            })
          },
          {
            type: "input_file",
            filename: fileName,
            file_data: fileDataUrl
          }
        ]
      }
    ],
    schemaName: "cv_profile_import",
    schema: profileSchema,
    maxOutputTokens: 3000
  });

  return profileDraftToProfile(JSON.parse(text) as ProfileDraft);
}

export async function enrichProfileFromText(
  pastedText: string,
  currentProfile: Profile,
  settings: Settings
): Promise<Profile> {
  if (!settings.apiKey) throw new Error("OpenAI API key is required before adding profile facts.");
  if (!pastedText.trim()) throw new Error("Paste some profile information first.");
  const { resumeFile, coverLetterFile } = currentProfile;
  const profileFacts = profileFactsForAi(currentProfile);

  const text = await createOpenAiJson(settings, {
    instructions:
      "Merge explicit candidate facts from the pasted text into the existing profile. Return the complete profile. Preserve every existing value unless the pasted text clearly adds, expands, or corrects it. Never erase existing facts because they are absent from the pasted text. Do not infer demographics, work authorization, legal answers, salary, dates, employers, technologies, metrics, or credentials. Recognize personal software projects separately from employment. Put useful factual details that do not fit a structured field—such as client-facing responsibilities, AI tool usage, domain expertise, or completed application Q&A—into additionalKnowledge without losing the original meaning. Deduplicate experience, projects, skills, education, and additional knowledge. Use empty values only where the existing profile is already empty and the pasted text provides nothing. Keep resumeFileRef unchanged.",
    input: [
      {
        role: "user",
        content: JSON.stringify({ existingProfile: profileFacts, pastedText: pastedText.trim() })
      }
    ],
    schemaName: "profile_text_merge",
    schema: profileSchema,
    maxOutputTokens: 4000
  });

  return {
    ...profileDraftToProfile(JSON.parse(text) as ProfileDraft),
    resumeFile,
    coverLetterFile
  };
}

export async function draftApplicationFromJobPosting(
  postingText: string,
  settings: Settings,
  pageUrl: string
): Promise<JobPostingDraft> {
  if (!settings.apiKey) throw new Error("OpenAI API key is required before parsing a job posting.");
  if (!postingText.trim()) throw new Error("Paste a job posting first.");

  const text = await createOpenAiJson(settings, {
    instructions:
      "Extract a job-tracker entry from unstructured job posting text. Use only facts present in the pasted text or provided page URL. Do not invent company, role, location, work mode, or compensation. If compensation is not explicitly present in the pasted text, return compensation as empty text, empty currency, null min, null max, and empty period. Compensation text must preserve exact original salary/rate wording from the pasted text; structured min/max should be plain numbers only when explicitly present. Currency must be MXN, USD, EUR, or an empty string if unknown. If currency is not explicit and the period is monthly, amounts over 10000 are usually MXN and amounts under 10000 are usually USD. If the period is yearly, use the yearly equivalent threshold of 120000.",
    input: [
      {
        role: "user",
        content: JSON.stringify({
          pageUrl,
          postingText,
          allowedWorkModes: ["Remote", "Hybrid", "On-site", ""]
        })
      }
    ],
    schemaName: "job_posting_tracker_draft",
    schema: jobPostingSchema,
    maxOutputTokens: 2200
  });

  const draft = JSON.parse(text) as JobPostingExtraction;
  return {
    ...draft,
    jobDescription: postingText.trim(),
    compensation: normalizeExtractedCompensation(draft.compensation, postingText)
  };
}

function normalizeExtractedCompensation(compensation: Compensation | undefined, postingText: string): Compensation | undefined {
  if (!compensation) return undefined;
  if (!compensation.text.trim() && compensation.min == null && compensation.max == null && !compensation.currency && !compensation.period) {
    return undefined;
  }

  const normalizedPosting = normalizeLooseText(postingText);
  const normalizedCompensationText = normalizeLooseText(compensation.text);
  if (!normalizedCompensationText || !normalizedPosting.includes(normalizedCompensationText)) return undefined;

  return normalizeCompensationCurrency(compensation);
}

function normalizeLooseText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function profileFactsForAi(profile: Profile): Omit<Profile, "resumeFile" | "coverLetterFile"> {
  const { resumeFile: _resumeFile, coverLetterFile: _coverLetterFile, ...profileFacts } = profile;
  return profileFacts;
}

async function createOpenAiJson(
  settings: Settings,
  request: {
    instructions: string;
    input: unknown[];
    schemaName: string;
    schema: object;
    maxOutputTokens: number;
  }
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      input: [
        {
          role: "developer",
          content: request.instructions
        },
        ...request.input
      ],
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName,
          strict: true,
          schema: request.schema
        }
      },
      max_output_tokens: request.maxOutputTokens
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  }

  return extractOpenAiText((await response.json()) as OpenAiResponse);
}

function extractOpenAiText(payload: OpenAiResponse): string {
  if (payload.status === "incomplete") {
    throw new Error(`OpenAI response was incomplete: ${payload.incomplete_details?.reason ?? "unknown reason"}.`);
  }
  if (payload.output_text) return payload.output_text;

  for (const item of payload.output ?? []) {
    const content = item.content ?? [];
    const refusal = content.find((entry) => entry.type === "refusal")?.refusal;
    if (refusal) throw new Error(`OpenAI refused the request: ${refusal}`);

    const text = content.find((entry) => entry.type === "output_text")?.text;
    if (text) return text;
  }

  throw new Error("OpenAI response did not include output text.");
}

function profileDraftToProfile(draft: ProfileDraft): Profile {
  const skills: Profile["skills"] = {};
  for (const skill of draft.skills) {
    if (!skill.name.trim()) continue;
    skills[skill.name.trim()] = {
      years: skill.years,
      note: skill.note,
      services: skill.services
    };
  }

  return normalizeProfilePhone({
    ...EMPTY_PROFILE,
    ...draft,
    identity: {
      ...EMPTY_PROFILE.identity,
      ...draft.identity,
      address: {
        ...EMPTY_PROFILE.identity.address,
        ...draft.identity.address
      },
      location: {
        ...EMPTY_PROFILE.identity.location,
        ...draft.identity.location
      },
      links: {
        ...EMPTY_PROFILE.identity.links,
        ...draft.identity.links
      }
    },
    workAuthorization: {
      ...EMPTY_PROFILE.workAuthorization,
      ...draft.workAuthorization
    },
    demographics: {
      ...EMPTY_PROFILE.demographics,
      ...draft.demographics
    },
    applicationDefaults: {
      ...EMPTY_PROFILE.applicationDefaults,
      ...draft.applicationDefaults
    },
    skills
  });
}
