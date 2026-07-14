import type { CanonicalField } from "./schema";

export const SYNONYMS: Record<CanonicalField, string[]> = {
  "identity.firstName": ["first name", "given name", "legal first name"],
  "identity.middleName": ["middle name"],
  "identity.lastName": ["last name", "surname", "family name", "legal last name"],
  "identity.email": ["email", "email address", "e-mail"],
  "identity.phoneCountryCode": ["country code", "phone country code", "dialing code", "dialling code"],
  "identity.phone": ["phone", "phone number", "mobile", "telephone"],
  "identity.address.line1": ["address line 1", "address 1", "street address"],
  "identity.address.line2": ["address line 2", "address 2", "apartment", "suite"],
  "identity.address.postalCode": ["postal code", "zip code", "zip"],
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
  "workAuthorization.visaStatus": ["visa status", "immigration status"],
  "workAuthorization.englishProficiency": [
    "english proficiency",
    "english level",
    "spoken english",
    "written english"
  ],
  "applicationDefaults.referralSource": ["how did you hear", "referral source", "source of application"],
  "applicationDefaults.referralDetails": ["if other please provide details", "other referral details"],
  "applicationDefaults.employeeReferralName": ["employee referral", "referral name", "referred by"],
  "applicationDefaults.needsRecruitmentAdjustments": ["require any reasonable adjustments", "need any accommodations", "recruitment adjustments"],
  "applicationDefaults.recruitmentAdjustmentsDetails": ["if yes please specify", "adjustment details", "accommodation details"],
  "applicationDefaults.previouslyEmployedByFitch": ["previously been employed by a company within the fitch group", "previously employed by fitch"],
  "applicationDefaults.currentEmployer": ["current employer", "current company"],
  "applicationDefaults.currentTitle": ["current title", "current job title"],
  "applicationDefaults.currentSalary": ["current salary", "current compensation"],
  "applicationDefaults.desiredSalary": ["desired salary", "salary expectation", "expected salary"],
  "applicationDefaults.salaryCurrency": ["salary currency", "currency"],
  "applicationDefaults.profileVisibility": ["make my profile visible", "profile visibility"],
  "applicationDefaults.jobNotifications": ["job posting notifications", "job notifications", "notification"],
  "demographics.gender": ["self identified gender", "gender identity", "gender"],
  "demographics.race": ["ethnic origin", "ethnicity", "race"],
  "demographics.veteran": ["veteran status", "protected veteran"],
  "demographics.disability": ["consider yourself to have a disability", "disability status", "long term condition"]
};
