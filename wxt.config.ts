import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

const jobSiteMatches = [
  "https://*.greenhouse.io/*",
  "https://*.lever.co/*",
  "https://*.ashbyhq.com/*",
  "https://*.linkedin.com/jobs/*",
  "https://*.indeed.com/*",
  "https://*.comeet.co/*",
  "https://*.upwork.com/*"
];

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Job Autofill + Tracker",
    description: "Fill job applications from a local profile, draft screening answers, and track submissions.",
    version: "0.1.0",
    permissions: ["storage", "unlimitedStorage", "activeTab", "downloads", "scripting", "sidePanel"],
    host_permissions: ["https://*/*", "http://*/*", "https://api.openai.com/*"],
    action: {
      default_title: "Open Job Autofill"
    }
  },
  vite: () => ({
    plugins: [react(), tailwindcss()]
  })
});
