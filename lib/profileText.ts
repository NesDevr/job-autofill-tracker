import type { Experience, PersonalProject, Profile } from "./schema";

export function formatSkills(skills: Profile["skills"]): string {
  return Object.entries(skills)
    .map(([name, fact]) => `${name}|${fact.years}|${fact.note}${fact.services?.length ? `|${fact.services.join(",")}` : ""}`)
    .join("\n");
}

export function parseSkills(value: string): Profile["skills"] {
  const skills: Profile["skills"] = {};
  for (const line of value.split("\n")) {
    if (!line.trim()) continue;
    const [name, years, note, services] = line.split("|");
    skills[name.trim()] = {
      years: Number(years),
      note: note?.trim() ?? "",
      services: services?.split(",").map((item) => item.trim()).filter(Boolean)
    };
  }
  return skills;
}

export function formatExperience(experience: Experience[]): string {
  return experience
    .map((item) => [
      `${item.title}|${item.company}|${item.start}|${item.end}`,
      item.highlights.join("; "),
      item.stack.join(", ")
    ].join("\n"))
    .join("\n\n");
}

export function parseExperience(value: string): Experience[] {
  return blocks(value).map((block) => {
    const [header = "", highlights = "", stack = ""] = block.split("\n");
    const [title = "", company = "", start = "", end = ""] = header.split("|");
    return {
      title: title.trim(),
      company: company.trim(),
      start: start.trim(),
      end: end.trim(),
      highlights: list(highlights, ";"),
      stack: list(stack, ",")
    };
  });
}

export function formatProjects(projects: PersonalProject[]): string {
  return projects
    .map((project) => [
      `${project.name}|${project.role}|${project.start}|${project.end}`,
      project.description,
      project.highlights.join("; "),
      project.stack.join(", "),
      `${project.url}|${project.repository}`
    ].join("\n"))
    .join("\n\n");
}

export function parseProjects(value: string): PersonalProject[] {
  return blocks(value).map((block) => {
    const [header = "", description = "", highlights = "", stack = "", links = ""] = block.split("\n");
    const [name = "", role = "", start = "", end = ""] = header.split("|");
    const [url = "", repository = ""] = links.split("|");
    return {
      name: name.trim(),
      description: description.trim(),
      role: role.trim(),
      start: start.trim(),
      end: end.trim(),
      highlights: list(highlights, ";"),
      stack: list(stack, ","),
      url: url.trim(),
      repository: repository.trim()
    };
  });
}

function blocks(value: string): string[] {
  return value.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
}

function list(value: string, separator: string): string[] {
  return value.split(separator).map((item) => item.trim()).filter(Boolean);
}
