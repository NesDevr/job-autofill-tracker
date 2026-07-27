import type { Profile } from "./schema";

export type ProfileTermSource = "skill" | "service" | "stack";

export type AffinityResult = {
  score: number;
  matched: Array<{ term: string; source: ProfileTermSource }>;
  missing: string[];
  jobTermCount: number;
};

// Canonical term -> variants also accepted in job text and profile entries.
const ALIASES: Record<string, string[]> = {
  javascript: ["js"],
  typescript: ["ts"],
  "node.js": ["node", "nodejs"],
  react: ["reactjs", "react.js"],
  "next.js": ["nextjs", "next js"],
  "vue.js": ["vue", "vuejs"],
  postgresql: ["postgres"],
  "sql server": ["mssql", "microsoft sql server"],
  mongodb: ["mongo"],
  kubernetes: ["k8s"],
  "google cloud": ["gcp", "google cloud platform"],
  "amazon web services": ["aws"],
  "c#": ["csharp", "c sharp"],
  "c++": ["cpp"],
  ".net": ["dotnet", "dot net", "asp.net"],
  "tailwind css": ["tailwind", "tailwindcss"],
  "spring boot": ["spring"],
  "ruby on rails": ["rails"],
  "rest api": ["rest apis", "restful"],
  "machine learning": ["ml"],
  "scikit learn": ["sklearn"],
  "ci cd": ["cicd", "continuous integration"],
  "test driven development": ["tdd"],
  "unit testing": ["unit tests"],
  "web scraping": ["scraping"],
  "power bi": ["powerbi"],
  elasticsearch: ["elastic search"],
  "react native": ["reactnative"],
  wordpress: ["word press"]
};

// Terms detected in job descriptions; only these count toward the score.
// Deliberately excludes one-letter/ambiguous names ("c", "r", "go") to avoid false positives.
const SKILL_LEXICON: string[] = [
  // languages
  "javascript", "typescript", "python", "java", "c#", "c++", "ruby", "php", "golang", "rust",
  "kotlin", "swift", "scala", "elixir", "dart", "objective c", ".net",
  // frontend
  "react", "next.js", "vue.js", "nuxt", "angular", "svelte", "html", "css", "sass",
  "tailwind css", "bootstrap", "redux", "webpack", "vite", "jquery", "material ui", "storybook",
  // mobile
  "react native", "flutter", "android", "ios", "expo",
  // backend
  "node.js", "express", "nestjs", "django", "flask", "fastapi", "spring boot", "laravel",
  "ruby on rails", "graphql", "rest api", "grpc", "websocket", "microservices",
  // databases
  "postgresql", "mysql", "sql server", "sqlite", "mongodb", "redis", "elasticsearch",
  "dynamodb", "firebase", "supabase", "oracle", "cassandra", "sql", "nosql",
  // cloud & devops
  "amazon web services", "azure", "google cloud", "docker", "kubernetes", "terraform",
  "ansible", "jenkins", "github actions", "ci cd", "linux", "bash", "powershell", "nginx",
  "serverless", "lambda", "cloudflare", "heroku", "vercel", "netlify",
  // data & ml
  "pandas", "numpy", "machine learning", "deep learning", "tensorflow", "pytorch",
  "scikit learn", "nlp", "computer vision", "opencv", "spark", "hadoop", "airflow", "etl",
  "data engineering", "data science", "power bi", "tableau", "excel", "dbt", "snowflake",
  "bigquery", "kafka", "rag", "llm", "openai", "langchain",
  // testing
  "jest", "vitest", "cypress", "playwright", "selenium", "pytest", "unit testing",
  // practices & tools
  "git", "github", "gitlab", "jira", "agile", "scrum", "test driven development", "oop",
  "design patterns", "figma", "wordpress", "shopify", "stripe", "oauth", "jwt", "webrtc",
  "chrome extension", "web scraping", "automation", "api integration", "zapier", "n8n"
];

// Keeps + # . so "c++", "c#", and ".net" survive normalization.
function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Compiled once per unique term: scoreAffinity runs per job card on search
// pages, and fresh RegExp construction per test dominates its cost.
const TERM_REGEX = new Map<string, RegExp>();

function containsTerm(text: string, term: string): boolean {
  let regex = TERM_REGEX.get(term);
  if (!regex) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    regex = new RegExp(`(?<![a-z0-9+#])${escaped}(?![a-z0-9+#])`);
    TERM_REGEX.set(term, regex);
  }
  return regex.test(text);
}

const VARIANT_MAP: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    const variants = [canonical, ...aliases];
    for (const variant of variants) map.set(variant, variants);
  }
  return map;
})();

function variantsOf(term: string): string[] {
  return VARIANT_MAP.get(term) ?? [term];
}

const PROFILE_TERMS_CACHE = new WeakMap<Profile, Map<string, ProfileTermSource>>();

export function collectProfileTerms(profile: Profile): Map<string, ProfileTermSource> {
  const cached = PROFILE_TERMS_CACHE.get(profile);
  if (cached) return cached;
  const terms = new Map<string, ProfileTermSource>();
  const add = (raw: string, source: ProfileTermSource) => {
    const term = normalizeText(raw);
    if (term && !terms.has(term)) terms.set(term, source);
  };
  for (const name of Object.keys(profile.skills)) add(name, "skill");
  for (const fact of Object.values(profile.skills)) {
    for (const service of fact.services ?? []) add(service, "service");
  }
  for (const experience of profile.experience) {
    for (const item of experience.stack) add(item, "stack");
  }
  for (const project of profile.personalProjects) {
    for (const item of project.stack) add(item, "stack");
  }
  PROFILE_TERMS_CACHE.set(profile, terms);
  return terms;
}

export function scoreAffinity(profile: Profile, jobText: string): AffinityResult {
  const text = normalizeText(jobText);
  const profileTerms = collectProfileTerms(profile);
  const jobTerms = SKILL_LEXICON.filter((term) => variantsOf(term).some((variant) => containsTerm(text, variant)));

  const coveredJobTerms = new Set<string>();
  const matched: AffinityResult["matched"] = [];
  for (const [term, source] of profileTerms) {
    const variants = variantsOf(term);
    if (!variants.some((variant) => containsTerm(text, variant))) continue;
    matched.push({ term, source });
    for (const jobTerm of jobTerms) {
      if (variantsOf(jobTerm).some((variant) => variants.includes(variant))) coveredJobTerms.add(jobTerm);
    }
  }

  const missing = jobTerms.filter((term) => !coveredJobTerms.has(term));
  const jobTermCount = jobTerms.length;
  const score = jobTermCount === 0 ? 0 : Math.round((100 * coveredJobTerms.size) / jobTermCount);
  return { score, matched, missing, jobTermCount };
}
