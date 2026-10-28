export default defineUnlistedScript(() => {
  // MAIN world: intercept the page's fetch, not the autofill content script's.
  const originalFetch = window.fetch;
  window.fetch = new Proxy(originalFetch, {
    apply(target, thisArg, args: Parameters<typeof fetch>) {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
      if (typeof url === "string" && /^\s*chrome-extension:/i.test(url)) {
        // LinkedIn treats any resolved response as a detected extension.
        // Reject instead, matching an inaccessible resource without a request.
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Reflect.apply(target, thisArg, args);
    }
  });
});
