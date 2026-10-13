import { createApi } from "./lib/api";
import { normalizeOrigin, originPermissionPattern, siteUrl } from "./lib/origin";
import { BUILD_DEFAULT_ORIGIN, getOrigin, setOrigin } from "./lib/settings";

const form = document.getElementById("origin-form") as HTMLFormElement;
const input = document.getElementById("origin") as HTMLInputElement;
const status = document.getElementById("origin-status")!;
const reset = document.getElementById("reset-origin") as HTMLButtonElement;
const micButton = document.getElementById("allow-mic") as HTMLButtonElement;
const micStatus = document.getElementById("mic-status")!;
const privacyLink = document.getElementById("privacy-link") as HTMLAnchorElement;

function say(text: string, tone: "muted" | "error" | "success" = "muted") {
  status.textContent = text;
  status.className = `small ${tone}`;
}

async function describeConnection(origin: string) {
  try {
    const user = await createApi(origin).me();
    say(user ? `Connected. Signed in as ${user.email}.` : "Connected. Sign in on the site to use the extension.", "success");
  } catch {
    say("Saved, but the site did not answer. Check the address.", "error");
  }
}

async function save(raw: string) {
  const result = normalizeOrigin(raw);
  if (!result.ok) {
    say(result.error, "error");
    return;
  }
  const origins = [originPermissionPattern(result.origin)];
  // Chrome only lets the extension talk to sites it was given; ask for a new one now, while the click counts.
  const granted = (await chrome.permissions.contains({ origins })) || (await chrome.permissions.request({ origins }));
  if (!granted) {
    say("Chrome did not grant access to that site, so the address was not changed.", "error");
    return;
  }
  await setOrigin(result.origin);
  input.value = result.origin;
  privacyLink.href = siteUrl(result.origin, "/privacy");
  say("Checking the connection");
  await describeConnection(result.origin);
}

form.addEventListener("submit", event => {
  event.preventDefault();
  void save(input.value);
});

reset.addEventListener("click", () => {
  input.value = BUILD_DEFAULT_ORIGIN;
  void save(BUILD_DEFAULT_ORIGIN);
});

async function refreshMic() {
  try {
    const state = (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
    micStatus.textContent = state === "granted" ? "Allowed" : state === "denied" ? "Blocked. Allow it in Chrome's site settings for this extension." : "Not allowed yet";
    micButton.hidden = state === "granted";
  } catch {
    micStatus.textContent = "";
  }
}

micButton.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
  } catch {
    // The status line explains what happened.
  }
  await refreshMic();
});

void (async () => {
  const origin = await getOrigin();
  input.value = origin;
  input.placeholder = BUILD_DEFAULT_ORIGIN;
  privacyLink.href = siteUrl(origin, "/privacy");
  await refreshMic();
})();
