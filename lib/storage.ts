import { DEFAULT_SETTINGS, EMPTY_PROFILE, type DashboardLaunch, type PendingApplication, type Profile, type Settings, type SidebarLaunch } from "./schema";

const PROFILE_KEY = "profile";
const SETTINGS_KEY = "settings";
const PENDING_APPLICATIONS_KEY = "pendingApplications";
const DASHBOARD_LAUNCH_KEY = "dashboardLaunch";
const SIDEBAR_LAUNCH_KEY = "sidebarLaunch";

export async function getProfile(): Promise<Profile> {
  const result = await chrome.storage.local.get(PROFILE_KEY);
  const stored = result[PROFILE_KEY] as Partial<Profile> | undefined;
  return {
    ...EMPTY_PROFILE,
    ...stored,
    identity: {
      ...EMPTY_PROFILE.identity,
      ...stored?.identity,
      location: {
        ...EMPTY_PROFILE.identity.location,
        ...stored?.identity?.location
      },
      links: {
        ...EMPTY_PROFILE.identity.links,
        ...stored?.identity?.links
      }
    },
    workAuthorization: {
      ...EMPTY_PROFILE.workAuthorization,
      ...stored?.workAuthorization
    },
    demographics: {
      ...EMPTY_PROFILE.demographics,
      ...stored?.demographics
    }
  };
}

export async function saveProfile(profile: Profile): Promise<void> {
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    enabledSites: {
      ...DEFAULT_SETTINGS.enabledSites,
      ...stored?.enabledSites
    }
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getPendingApplications(): Promise<PendingApplication[]> {
  const result = await chrome.storage.local.get(PENDING_APPLICATIONS_KEY);
  return (result[PENDING_APPLICATIONS_KEY] as PendingApplication[] | undefined) ?? [];
}

export async function queuePendingApplication(pending: PendingApplication): Promise<void> {
  const pendingApplications = await getPendingApplications();
  if (pendingApplications.some((item) => item.id === pending.id)) return;
  await chrome.storage.local.set({ [PENDING_APPLICATIONS_KEY]: [pending, ...pendingApplications] });
}

export async function removePendingApplication(id: string): Promise<void> {
  const pendingApplications = await getPendingApplications();
  await chrome.storage.local.set({
    [PENDING_APPLICATIONS_KEY]: pendingApplications.filter((item) => item.id !== id)
  });
}

export async function setDashboardLaunch(launch: DashboardLaunch): Promise<void> {
  await chrome.storage.local.set({ [DASHBOARD_LAUNCH_KEY]: launch });
}

export async function getDashboardLaunch(): Promise<DashboardLaunch | undefined> {
  const result = await chrome.storage.local.get(DASHBOARD_LAUNCH_KEY);
  return result[DASHBOARD_LAUNCH_KEY] as DashboardLaunch | undefined;
}

export async function clearDashboardLaunch(): Promise<void> {
  await chrome.storage.local.remove(DASHBOARD_LAUNCH_KEY);
}

export async function setSidebarLaunch(launch: SidebarLaunch): Promise<void> {
  await chrome.storage.local.set({ [SIDEBAR_LAUNCH_KEY]: launch });
}

export async function getSidebarLaunch(): Promise<SidebarLaunch | undefined> {
  const result = await chrome.storage.local.get(SIDEBAR_LAUNCH_KEY);
  return result[SIDEBAR_LAUNCH_KEY] as SidebarLaunch | undefined;
}

export async function clearSidebarLaunch(): Promise<void> {
  await chrome.storage.local.remove(SIDEBAR_LAUNCH_KEY);
}
