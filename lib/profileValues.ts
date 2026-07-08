import type { Profile } from "./schema";

export function formatProfilePhone(profile: Profile): string {
  const code = profile.identity.phoneCountryCode.trim();
  const phone = formatProfileNationalPhone(profile);
  if (!phone) return "";
  if (!code || phone.replace(/\s+/g, "").startsWith(code.replace(/\s+/g, ""))) return phone;
  return `${code} ${phone}`.trim();
}

export function formatProfileNationalPhone(profile: Profile): string {
  const code = profile.identity.phoneCountryCode.trim().replace(/\s+/g, "");
  const phone = profile.identity.phone.trim();
  const compactPhone = phone.replace(/\s+/g, "");
  if (!code || !compactPhone.startsWith(code)) return phone;
  return compactPhone.slice(code.length);
}

export function normalizeProfilePhone(profile: Profile): Profile {
  const code = profile.identity.phoneCountryCode.trim();
  const phone = profile.identity.phone.trim();
  if (!code || !phone.replace(/\s+/g, "").startsWith(code.replace(/\s+/g, ""))) return profile;

  return {
    ...profile,
    identity: {
      ...profile.identity,
      phone: phone.replace(/\s+/g, "").slice(code.replace(/\s+/g, "").length)
    }
  };
}
