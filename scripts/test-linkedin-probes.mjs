import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const [pageBundle, registrationBundle] = await Promise.all([
  build({ entryPoints: ["entrypoints/linkedin-probe-blocker.ts"], bundle: true, format: "iife", write: false }),
  build({ entryPoints: ["lib/linkedinProbeProtection.ts"], bundle: true, platform: "node", format: "esm", write: false })
]);

function protectedPage() {
  const calls = [];
  const response = { ok: true };
  const window = {
    fetch(...args) {
      calls.push({ receiver: this, args });
      return Promise.resolve(response);
    }
  };
  vm.runInNewContext(pageBundle.outputFiles[0].text, {
    window, URL, Request,
    defineUnlistedScript: (main) => main()
  });
  return { window, calls, response };
}

test("extension probes reject without issuing a request or reporting fake success", async () => {
  const { window, calls } = protectedPage();
  const url = `chrome-extension://${"a".repeat(32)}/icon.png`;
  for (const input of [url, new URL(url), new Request(url), "chrome-extension://invalid/", "  CHROME-EXTENSION://invalid/"]) {
    await assert.rejects(window.fetch(input), /Failed to fetch/);
  }
  assert.equal(calls.length, 0);
});

test("normal fetches preserve arguments, receiver, and response", async () => {
  const { window, calls, response } = protectedPage();
  const receiver = {};
  const options = { method: "POST", body: "example" };
  for (const input of ["/voyager/api/jobs", new URL("https://www.linkedin.com/feed/"), new Request("https://example.com/"), "https://example.com/?text=chrome-extension://invalid/"]) {
    assert.equal(await window.fetch.call(receiver, input, options), response);
    const call = calls.at(-1);
    assert.equal(call.receiver, receiver);
    assert.equal(call.args[0], input);
    assert.equal(call.args[1], options);
  }
  assert.equal(calls.length, 4);
});

let settings = {};
let scripts = [];
let registrations = 0;
let updates = 0;
let failNextRead = false;
globalThis.chrome = {
  storage: { local: { async get() { return { settings }; } } },
  scripting: {
    async getRegisteredContentScripts() {
      if (failNextRead) { failNextRead = false; throw new Error("Temporary registration failure"); }
      return structuredClone(scripts);
    },
    async registerContentScripts(next) { registrations++; scripts = structuredClone(next); },
    async updateContentScripts(next) { updates++; scripts = structuredClone(next); },
    async unregisterContentScripts() { scripts = []; }
  }
};
const { syncLinkedInProbeProtection } = await import(`data:text/javascript;base64,${Buffer.from(registrationBundle.outputFiles[0].text).toString("base64")}`);

test("default and older settings register an early persistent hook in LinkedIn frames", async () => {
  await syncLinkedInProbeProtection();
  assert.equal(registrations, 1);
  assert.equal(scripts.length, 1);
  assert.deepEqual(scripts[0].matches, ["https://*.linkedin.com/*"]);
  assert.deepEqual(scripts[0].js, ["linkedin-probe-blocker.js"]);
  assert.equal(scripts[0].world, "MAIN");
  assert.equal(scripts[0].runAt, "document_start");
  assert.equal(scripts[0].allFrames, true);
  assert.equal(scripts[0].matchOriginAsFallback, true);
  assert.equal(scripts[0].persistAcrossSessions, true);
  await syncLinkedInProbeProtection();
  assert.equal(registrations, 1);
  assert.equal(updates, 1);
});

test("disabling unregisters the hook, and enabling restores it", async () => {
  settings = { blockLinkedInExtensionProbes: false };
  await syncLinkedInProbeProtection();
  assert.deepEqual(scripts, []);
  await syncLinkedInProbeProtection();
  assert.deepEqual(scripts, []);
  settings.blockLinkedInExtensionProbes = true;
  await syncLinkedInProbeProtection();
  assert.equal(scripts.length, 1);
});

test("registration can recover from an API error and concurrent setting changes", async () => {
  failNextRead = true;
  await assert.rejects(syncLinkedInProbeProtection(), /Temporary registration failure/);
  await syncLinkedInProbeProtection();
  settings.blockLinkedInExtensionProbes = true;
  const first = syncLinkedInProbeProtection();
  settings.blockLinkedInExtensionProbes = false;
  const second = syncLinkedInProbeProtection();
  await Promise.all([first, second]);
  assert.deepEqual(scripts, []);
});
