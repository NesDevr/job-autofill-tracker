import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Job Autofill + Tracker",
    description: "Fill job applications from a local profile, draft screening answers, and track submissions.",
    version: "0.1.0",
    permissions: ["storage", "unlimitedStorage", "activeTab", "downloads", "scripting", "alarms"],
    host_permissions: ["https://*/*", "http://*/*", "https://api.openai.com/*"],
    action: {
      default_title: "Job Autofill + Tracker"
    },
    commands: {
      "toggle-widget": {
        suggested_key: { default: "Alt+J" },
        description: "Toggle the JobTracker widget"
      }
    }
  },
  vite: () => ({
    plugins: [react(), tailwindcss()]
  })
});
