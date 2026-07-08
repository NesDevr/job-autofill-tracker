import type { CanonicalField } from "./schema";

export const SYNONYMS: Record<CanonicalField, string[]> = {
  "identity.firstName": ["first name", "given name", "legal first name"],
  "identity.lastName": ["last name", "surname", "family name", "legal last name"],
  "identity.email": ["email", "email address", "e-mail"],
  "identity.phone": ["phone", "phone number", "mobile", "telephone"],
  "identity.location.city": ["city", "current city", "location city"],
  "identity.location.state": ["state", "province", "region", "current state", "location state"],
  "identity.location.country": ["country", "current country", "location country"],
  "identity.links.linkedin": ["linkedin", "linkedin profile", "linkedin url"],
  "identity.links.github": ["github", "github profile", "github url"],
  "identity.links.portfolio": ["portfolio", "portfolio url", "personal website", "website"],
  "workAuthorization.usAuthorized": [
    "authorized to work in the united states",
    "legally authorized to work in the us",
    "us work authorization"
  ],
  "workAuthorization.requiresSponsorship": [
    "require sponsorship",
    "need sponsorship",
    "visa sponsorship",
    "employment sponsorship"
  ],
  "workAuthorization.englishProficiency": [
    "english proficiency",
    "english level",
    "spoken english",
    "written english"
  ]
};
