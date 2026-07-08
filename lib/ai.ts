import { rememberAnswer } from "./mapping";
import { normalizeProfilePhone } from "./profileValues";
import { EMPTY_PROFILE, type Application, type FieldDescriptor, type FieldFill, type Profile, type Settings } from "./schema";

type OpenAiOutputContent = {
  type: string;
  text?: string;
  refusal?: string;
};

type OpenAiResponse = {
  output?: Array<{
    type: string;
    content?: OpenAiOutputContent[];
  }>;
  output_text?: string;
};

type CvProfileDraft = Omit<Profile, "skills"> & {
  skills: Array<{
    name: string;
    years: number;
    note: string;
    services: string[];
  }>;
};

type JobPostingDraft = Pick<Application, "company" | "role" | "location" | "workMode" | "jobDescription" | "source" | "jobUrl">;

const answerSchema = {
  type: "object",
  additionalProperties: { type: "string" }
};

const cvProfileSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "identity",
    "workAuthorization",
    "experience",
    "skills",
    "education",
    "demographics",
    "resumeFileRef"
  ],
  properties: {
    identity: {
      type: "object",
      additionalProperties: false,
      required: ["firstName", "lastName", "preferredName", "email", "phone", "phoneCountryCode", "location", "links"],
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string" },
        preferredName: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        phoneCountryCode: { type: "string" },
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
      required: ["usAuthorized", "requiresSponsorship", "eligibleCountries", "timezonesComfortable", "englishProficiency"],
      properties: {
        usAuthorized: { type: "boolean" },
        requiresSponsorship: { type: "boolean" },
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
    resumeFileRef: { type: "string" }
  }
};

const jobPostingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["company", "role", "location", "workMode", "jobDescription", "source", "jobUrl"],
  properties: {
    company: { type: "string" },
    role: { type: "string" },
    location: { type: "string" },
    workMode: { type: "string", enum: ["Remote", "Hybrid", "On-site", ""] },
    jobDescription: { type: "string" },
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
    instructions:
      "You help a candidate fill job applications. Write in first person. Use only the facts provided. Never invent tools, years, employers, credentials, locations, or authorization. If a needed fact is missing, include a clear [TODO] placeholder.",
    input: [
      {
        role: "user",
        content: JSON.stringify({
          candidateFacts: profile,
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
    if (!value) continue;
    fills.push({ id: question.fieldId, value, source: "ai", confidence: 0.7 });
    await rememberAnswer(question.question, value);
  }
  return fills;
}

export async function importProfileFromCv(
  fileName: string,
  fileDataUrl: string,
  currentProfile: Profile,
  settings: Settings
): Promise<Profile> {
  if (!settings.apiKey) throw new Error("OpenAI API key is required before importing a CV.");

  const text = await createOpenAiJson(settings, {
    instructions:
      "Extract a candidate profile from the attached CV PDF. Use only facts present in the CV. Preserve existing profile values when the CV does not provide a value. Use empty strings, empty arrays, or false only when neither the CV nor the existing profile provides a value. Do not infer demographics.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              existingProfile: currentProfile,
              targetShape:
                "Return a complete profile draft. Skills must be an array with name, years, note, and services.",
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
    schema: cvProfileSchema,
    maxOutputTokens: 3000
  });

  return cvDraftToProfile(JSON.parse(text) as CvProfileDraft);
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
      "Extract a job-tracker entry from unstructured job posting text. Use only facts present in the pasted text or provided page URL. Do not invent company, role, location, or work mode. If a value is missing, use an empty string. Keep jobDescription concise but useful, preserving responsibilities, requirements, and compensation details when present.",
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

  return JSON.parse(text) as JobPostingDraft;
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

function cvDraftToProfile(draft: CvProfileDraft): Profile {
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
    skills
  });
}
