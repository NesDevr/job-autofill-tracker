import type { SavedSearch } from "./schema";

// Preset quick-launch job searches shown in the popup. This file is the single
// source of truth for presets — edit here, then rebuild + reload. Your own links
// added from the popup live in settings.customSearches, separate from these.
// LinkedIn params: geoId=103323778 is Mexico, f_TPR=r2592000 is the past 30 days,
// f_WT=2 applies the remote-work filter.

export const SAVED_SEARCHES: SavedSearch[] = [
  {
    id: "preset-django-mx-any",
    label: "Django · Mexico · any · 30d",
    url: "https://www.linkedin.com/jobs/search/?keywords=django&geoId=103323778&f_TPR=r2592000"
  },
  {
    id: "preset-django-mx-remote",
    label: "Django · Mexico · remote · 30d",
    url: "https://www.linkedin.com/jobs/search/?keywords=django&geoId=103323778&f_TPR=r2592000&f_WT=2"
  },
  {
    id: "preset-python-mx-any",
    label: "Python · Mexico · any · 30d",
    url: "https://www.linkedin.com/jobs/search/?keywords=python&geoId=103323778&f_TPR=r2592000"
  },
  {
    id: "preset-python-mx-remote",
    label: "Python · Mexico · remote · 30d",
    url: "https://www.linkedin.com/jobs/search/?keywords=python&geoId=103323778&f_TPR=r2592000&f_WT=2"
  }
];
