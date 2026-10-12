/**
 * Development-only preload that sends the server's AssemblyAI REST calls to
 * a local mock (scripts/dev/mock-phase4-services.mjs), so a seeded
 * "processing" recording can complete end to end without a key:
 *
 *   NODE_OPTIONS="--import ./scripts/dev/redirect-assemblyai.mjs" \
 *   MOCK_ASSEMBLYAI_URL=http://127.0.0.1:7072/assemblyai ASSEMBLYAI_API_KEY=dev npm run dev
 *
 * Never used in production: nothing imports it, it only runs when preloaded.
 */
const target = process.env.MOCK_ASSEMBLYAI_URL || "http://127.0.0.1:7072/assemblyai";
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith("https://api.assemblyai.com/v2")) {
    return realFetch(url.replace("https://api.assemblyai.com/v2", target), init);
  }
  return realFetch(input, init);
};
