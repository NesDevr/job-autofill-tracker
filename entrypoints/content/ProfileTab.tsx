import { useEffect, useRef, useState, type ReactNode } from "react";
import { getProfile, saveProfile } from "../../lib/storage";
import type { ExtensionMessage, Profile } from "../../lib/schema";

export default function ProfileTab({ demoMode, onOpenDashboard }: { demoMode: boolean; onOpenDashboard: () => void }) {
  // Owns its profile copy (seeded once) instead of syncing from storage while
  // mounted, so an autosave landing mid-edit can't clobber in-progress typing.
  const [profile, setProfile] = useState<Profile>();
  const [saveStatus, setSaveStatus] = useState("Saved");
  const [smartAddText, setSmartAddText] = useState("");
  const [smartAddStatus, setSmartAddStatus] = useState("");
  const [smartAdding, setSmartAdding] = useState(false);
  const profileSaveReady = useRef(false);

  useEffect(() => {
    void getProfile().then(setProfile);
  }, []);

  useEffect(() => {
    if (!profile) return;
    if (!profileSaveReady.current) {
      profileSaveReady.current = true;
      return;
    }
    if (demoMode) {
      setSaveStatus("Temporary demo changes");
      return;
    }
    setSaveStatus("Saving...");
    const timer = window.setTimeout(() => {
      void saveProfile(profile)
        .then(() => setSaveStatus(`Saved ${new Date().toLocaleTimeString()}`))
        .catch((error: unknown) => setSaveStatus(error instanceof Error ? error.message : String(error)));
    }, 550);
    return () => window.clearTimeout(timer);
  }, [profile, demoMode]);

  if (!profile) return <p className="jtMuted">Loading profile...</p>;

  function updateProfile(path: string, value: string | boolean) {
    setProfile((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      const keys = path.split(".");
      let cursor = next as unknown as Record<string, unknown>;
      for (const key of keys.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
      cursor[keys.at(-1)!] = value;
      return next;
    });
  }

  function replaceList(path: "eligibleCountries" | "timezonesComfortable", value: string) {
    setProfile((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      next.workAuthorization[path] = value.split(",").map((item) => item.trim()).filter(Boolean);
      return next;
    });
  }

  async function smartAdd() {
    if (smartAdding) return;
    setSmartAdding(true);
    setSmartAddStatus("Reading your notes...");
    try {
      const response = await chrome.runtime.sendMessage({ kind: "AI_ENRICH_PROFILE", text: smartAddText } satisfies ExtensionMessage);
      if (!response?.ok) throw new Error(response?.error ?? "Profile enrichment failed.");
      setProfile(response.profile as Profile);
      setSmartAddText("");
      setSmartAddStatus("Profile updated. Review the sections below.");
    } catch (error) {
      setSmartAddStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSmartAdding(false);
    }
  }

  const skillCount = Object.keys(profile.skills).length;
  const name = `${profile.identity.firstName} ${profile.identity.lastName}`.trim();

  return (
    <div className="jtMatch">
      <div className="jtScoreRow">
        <span className="jtScoreLabel">{name || "Add your details"}</span>
        <span className="jtNotice">{saveStatus}</span>
      </div>

      <div className="jtChipGroup">
        <p className="jtChipHeading">Smart add</p>
        <textarea
          className="jtTextarea"
          rows={4}
          placeholder="Paste project notes, résumé text, a bio, skills, or any facts to add..."
          value={smartAddText}
          onChange={(event) => setSmartAddText(event.target.value)}
        />
        <button className="jtButton" disabled={smartAdding || !smartAddText.trim()} onClick={() => void smartAdd()}>
          {smartAdding ? "Adding..." : "Add with AI"}
        </button>
        {smartAddStatus && <p className="jtNotice">{smartAddStatus}</p>}
      </div>

      <div className="jtChipGroup">
        <p className="jtChipHeading">Skills, experience &amp; projects</p>
        <p className="jtMuted">
          {skillCount} skills · {profile.experience.length} roles · {profile.personalProjects.length} projects
        </p>
        <button className="jtButtonGhost" onClick={onOpenDashboard}>
          Edit in dashboard
        </button>
      </div>

      <ProfileSection title="Additional answer knowledge">
        <label className="jtField">
          <span>Completed Q&amp;As and other useful facts</span>
          <textarea
            className="jtTextarea"
            rows={6}
            value={profile.additionalKnowledge}
            onChange={(event) => updateProfile("additionalKnowledge", event.target.value)}
            placeholder="Paste facts that AI should remember for future answers..."
          />
        </label>
      </ProfileSection>

      <ProfileSection title="Identity & contact" open>
        <div className="jtProfileGrid">
          <ProfileField label="First name" value={profile.identity.firstName} onChange={(value) => updateProfile("identity.firstName", value)} />
          <ProfileField label="Middle name" value={profile.identity.middleName} onChange={(value) => updateProfile("identity.middleName", value)} />
          <ProfileField label="Last name" value={profile.identity.lastName} onChange={(value) => updateProfile("identity.lastName", value)} />
          <ProfileField label="Preferred name" value={profile.identity.preferredName} onChange={(value) => updateProfile("identity.preferredName", value)} />
          <ProfileField label="Email" value={profile.identity.email} onChange={(value) => updateProfile("identity.email", value)} wide />
          <ProfileField label="Country code" value={profile.identity.phoneCountryCode} onChange={(value) => updateProfile("identity.phoneCountryCode", value)} />
          <ProfileField label="Phone" value={profile.identity.phone} onChange={(value) => updateProfile("identity.phone", value)} />
          <ProfileField label="Address line 1" value={profile.identity.address.line1} onChange={(value) => updateProfile("identity.address.line1", value)} wide />
          <ProfileField label="Address line 2" value={profile.identity.address.line2} onChange={(value) => updateProfile("identity.address.line2", value)} wide />
          <ProfileField label="Postal code" value={profile.identity.address.postalCode} onChange={(value) => updateProfile("identity.address.postalCode", value)} />
          <ProfileField label="City" value={profile.identity.location.city} onChange={(value) => updateProfile("identity.location.city", value)} />
          <ProfileField label="State" value={profile.identity.location.state} onChange={(value) => updateProfile("identity.location.state", value)} />
          <ProfileField label="Country" value={profile.identity.location.country} onChange={(value) => updateProfile("identity.location.country", value)} />
          <ProfileField label="LinkedIn" value={profile.identity.links.linkedin} onChange={(value) => updateProfile("identity.links.linkedin", value)} wide />
          <ProfileField label="GitHub" value={profile.identity.links.github} onChange={(value) => updateProfile("identity.links.github", value)} wide />
          <ProfileField label="Portfolio" value={profile.identity.links.portfolio} onChange={(value) => updateProfile("identity.links.portfolio", value)} wide />
        </div>
      </ProfileSection>

      <ProfileSection title="Authorization & defaults">
        <ProfileToggle label="US authorized" checked={profile.workAuthorization.usAuthorized} onChange={(value) => updateProfile("workAuthorization.usAuthorized", value)} />
        <ProfileToggle label="Needs sponsorship" checked={profile.workAuthorization.requiresSponsorship} onChange={(value) => updateProfile("workAuthorization.requiresSponsorship", value)} />
        <ProfileToggle label="Needs recruitment adjustments" checked={profile.applicationDefaults.needsRecruitmentAdjustments} onChange={(value) => updateProfile("applicationDefaults.needsRecruitmentAdjustments", value)} />
        <ProfileToggle label="Job notifications" checked={profile.applicationDefaults.jobNotifications} onChange={(value) => updateProfile("applicationDefaults.jobNotifications", value)} />
        <div className="jtProfileGrid">
          <ProfileField label="Visa status" value={profile.workAuthorization.visaStatus} onChange={(value) => updateProfile("workAuthorization.visaStatus", value)} wide />
          <ProfileField label="English proficiency" value={profile.workAuthorization.englishProficiency} onChange={(value) => updateProfile("workAuthorization.englishProficiency", value)} wide />
          <ProfileField label="Eligible countries" value={profile.workAuthorization.eligibleCountries.join(", ")} onChange={(value) => replaceList("eligibleCountries", value)} wide />
          <ProfileField label="Time zones" value={profile.workAuthorization.timezonesComfortable.join(", ")} onChange={(value) => replaceList("timezonesComfortable", value)} wide />
          <ProfileField label="Referral source" value={profile.applicationDefaults.referralSource} onChange={(value) => updateProfile("applicationDefaults.referralSource", value)} />
          <ProfileField label="Referral details" value={profile.applicationDefaults.referralDetails} onChange={(value) => updateProfile("applicationDefaults.referralDetails", value)} />
          <ProfileField label="Current employer" value={profile.applicationDefaults.currentEmployer} onChange={(value) => updateProfile("applicationDefaults.currentEmployer", value)} />
          <ProfileField label="Current title" value={profile.applicationDefaults.currentTitle} onChange={(value) => updateProfile("applicationDefaults.currentTitle", value)} />
          <ProfileField label="Current salary" value={profile.applicationDefaults.currentSalary} onChange={(value) => updateProfile("applicationDefaults.currentSalary", value)} />
          <ProfileField label="Desired salary" value={profile.applicationDefaults.desiredSalary} onChange={(value) => updateProfile("applicationDefaults.desiredSalary", value)} />
          <ProfileField label="Salary currency" value={profile.applicationDefaults.salaryCurrency} onChange={(value) => updateProfile("applicationDefaults.salaryCurrency", value)} />
        </div>
      </ProfileSection>

      <ProfileSection title="Optional demographics">
        <div className="jtProfileGrid">
          <ProfileField label="Gender" value={profile.demographics.gender} onChange={(value) => updateProfile("demographics.gender", value)} />
          <ProfileField label="Ethnic origin" value={profile.demographics.race} onChange={(value) => updateProfile("demographics.race", value)} />
          <ProfileField label="Veteran status" value={profile.demographics.veteran} onChange={(value) => updateProfile("demographics.veteran", value)} />
          <ProfileField label="Disability" value={profile.demographics.disability} onChange={(value) => updateProfile("demographics.disability", value)} />
        </div>
      </ProfileSection>
    </div>
  );
}

function ProfileSection({ title, open = false, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="jtProfileSection" open={open}>
      <summary>{title}</summary>
      <div className="jtProfileSectionBody">{children}</div>
    </details>
  );
}

function ProfileField({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return (
    <label className={wide ? "jtField jtFieldWide" : "jtField"}>
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ProfileToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="jtToggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /> {label}
    </label>
  );
}
