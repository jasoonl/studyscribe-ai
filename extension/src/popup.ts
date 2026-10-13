import { TRANSCRIPTION_LANGUAGES } from "../../shared/languages";
import { ApiError, createApi, type RecordingSummary, type SessionUser, type StudyScribeApi } from "./lib/api";
import { h } from "./lib/dom";
import { defaultTitle, formatDuration, formatElapsed, formatRecordedDate, statusLabel } from "./lib/format";
import type { CommandResponse, ImportState, PopupMessage, RecorderState, StateResponse } from "./lib/messages";
import { checkImportableUrl, siteUrl } from "./lib/origin";
import { getOrigin, getPrefs, setPrefs } from "./lib/settings";

const app = document.getElementById("app")!;

let origin = "";
let api: StudyScribeApi;
let tab: chrome.tabs.Tab | undefined;
let state: StateResponse = { recorder: { status: "idle" }, importJob: { status: "idle" } };
let clock: ReturnType<typeof setInterval> | undefined;

function send<T extends StateResponse | CommandResponse>(message: PopupMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

function openSite(path: string) {
  void chrome.tabs.create({ url: siteUrl(origin, path) });
  window.close();
}

function link(text: string, path: string, className = "") {
  return h("a", { href: siteUrl(origin, path), className, onclick: ((event: Event) => { event.preventDefault(); openSite(path); }) as EventListener }, text);
}

function isRecordableTab(target: chrome.tabs.Tab | undefined): boolean {
  return Boolean(target?.id !== undefined && target.url && /^(https?|file):/.test(target.url));
}

async function micPermission(): Promise<PermissionState | "unknown"> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
  } catch {
    return "unknown";
  }
}

/* ---------- Signed out and unreachable ---------- */

function renderSignedOut() {
  app.replaceChildren(
    h(
      "section",
      { className: "panel stack" },
      h("h1", { className: "title" }, "Sign in to StudyScribe"),
      h("p", { className: "muted" }, "The extension uses your StudyScribe sign-in from this browser. Sign in on the site, then open the extension again."),
      h("div", { className: "row" },
        h("button", { className: "button button-primary", type: "button", onclick: (() => openSite("/login")) as EventListener }, "Sign in"),
        h("button", { className: "button button-ghost", type: "button", onclick: (() => void boot()) as EventListener }, "Check again"),
      ),
      h("p", { className: "muted small" }, "Connected to ", h("span", { className: "mono" }, new URL(origin).host), "."),
    ),
  );
}

function renderUnreachable(message: string) {
  app.replaceChildren(
    h(
      "section",
      { className: "panel stack" },
      h("h1", { className: "title" }, "StudyScribe is unreachable"),
      h("p", { className: "muted" }, message),
      h("div", { className: "row" },
        h("button", { className: "button button-primary", type: "button", onclick: (() => void boot()) as EventListener }, "Try again"),
        h("button", { className: "button button-ghost", type: "button", onclick: (() => void chrome.runtime.openOptionsPage()) as EventListener }, "Settings"),
      ),
    ),
  );
}

/* ---------- Signed in ---------- */

type Regions = { capture: HTMLElement; form: HTMLElement; recorder: HTMLElement; importStatus: HTMLElement; recent: HTMLElement };
let regions: Regions | null = null;

function buildForm(prefs: { withMic: boolean; language: string }) {
  const title = h("input", { className: "input", id: "title", name: "title", maxlength: 255, value: defaultTitle(tab?.title), autocomplete: "off" });
  const language = h(
    "select",
    { className: "select", id: "language", name: "language" },
    h("option", { value: "" }, "Detect automatically"),
    ...TRANSCRIPTION_LANGUAGES.map(entry => h("option", { value: entry.code }, entry.label)),
  );
  language.value = prefs.language;
  language.addEventListener("change", () => void setPrefs({ language: language.value }));
  const mic = h("input", { type: "checkbox", id: "with-mic", checked: prefs.withMic });
  mic.addEventListener("change", () => void setPrefs({ withMic: mic.checked }));

  const importCheck = checkImportableUrl(tab?.url, origin);
  const recordable = isRecordableTab(tab);
  const message = h("p", { className: "small error", id: "form-message", role: "alert" });

  const recordButton = h("button", { className: "button button-primary", type: "button", id: "record-button", disabled: !recordable }, "Record this tab");
  const importButton = h("button", { className: "button button-secondary", type: "button", id: "import-button", disabled: !importCheck.ok }, "Import this page");

  recordButton.addEventListener("click", async () => {
    message.textContent = "";
    if (!tab?.id) return;
    if (mic.checked && (await micPermission()) !== "granted") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
      window.close();
      return;
    }
    recordButton.disabled = true;
    const response = await send<CommandResponse>({
      type: "record:start",
      tabId: tab.id,
      tabTitle: tab.title || "this tab",
      title: title.value.trim() || defaultTitle(tab.title),
      withMic: mic.checked,
      language: language.value || undefined,
    });
    recordButton.disabled = !recordable;
    if (!response.ok) message.textContent = response.error;
  });

  importButton.addEventListener("click", async () => {
    message.textContent = "";
    if (!importCheck.ok) return;
    importButton.disabled = true;
    const typed = title.value.trim();
    const response = await send<CommandResponse>({
      type: "import:start",
      url: importCheck.url,
      // The server names the recording from the page when no title is given.
      title: typed && typed !== defaultTitle(tab?.title) ? typed : undefined,
      language: language.value || undefined,
    });
    importButton.disabled = false;
    if (!response.ok) message.textContent = response.error;
  });

  let host = "";
  try {
    host = tab?.url ? new URL(tab.url).host : "";
  } catch {
    host = "";
  }

  return h(
    "section",
    { className: "panel stack", "aria-labelledby": "tab-heading" },
    h("div", { className: "tab-summary" },
      h("h1", { className: "title clamp", id: "tab-heading" }, tab?.title || "This tab"),
      host ? h("p", { className: "muted small mono clamp" }, host) : null,
    ),
    h("div", { className: "field" }, h("label", { className: "label", for: "title" }, "Title"), title),
    h("div", { className: "field" }, h("label", { className: "label", for: "language" }, "Spoken language"), language),
    h("label", { className: "check", for: "with-mic" }, mic, h("span", {}, h("span", { className: "check-label" }, "Include my microphone"), h("span", { className: "muted small" }, "Adds your voice to the tab's audio."))),
    h("div", { className: "actions" }, recordButton, importButton),
    !recordable && !importCheck.ok ? h("p", { className: "muted small" }, importCheck.reason) : null,
    recordable && !importCheck.ok ? h("p", { className: "muted small" }, `Import is off here: ${importCheck.reason.charAt(0).toLowerCase()}${importCheck.reason.slice(1)}`) : null,
    message,
  );
}

function renderRecorder(recorder: RecorderState) {
  if (!regions) return;
  const busy = recorder.status === "recording" || recorder.status === "saving" || recorder.status === "starting";
  regions.form.hidden = busy;
  if (clock) clearInterval(clock);
  clock = undefined;

  if (recorder.status === "recording") {
    const time = h("p", { className: "timer", id: "timer" }, formatElapsed(Math.max(recorder.elapsedSeconds, (Date.now() - recorder.startedAt) / 1000)));
    clock = setInterval(() => {
      time.textContent = formatElapsed((Date.now() - recorder.startedAt) / 1000);
    }, 500);
    const stop = h("button", { className: "button button-primary", type: "button", id: "stop-button" }, "Stop and save");
    stop.addEventListener("click", async () => {
      stop.disabled = true;
      const response = await send<CommandResponse>({ type: "record:stop" });
      if (!response.ok) stop.disabled = false;
    });
    const discard = h("button", { className: "button button-ghost", type: "button", id: "discard-button" }, "Discard");
    discard.addEventListener("click", async () => {
      if (discard.dataset.confirm !== "yes") {
        discard.dataset.confirm = "yes";
        discard.textContent = "Discard recording?";
        return;
      }
      await send({ type: "record:discard" });
    });
    regions.recorder.replaceChildren(
      h("section", { className: "panel stack recording", "aria-label": "Recording" },
        h("p", { className: "recording-label" }, h("span", { className: "dot", "aria-hidden": "true" }), recorder.withMic ? "Recording tab and microphone" : "Recording tab audio"),
        time,
        h("p", { className: "muted small clamp" }, recorder.title),
        h("p", { className: "muted small" }, "The tab stays audible. You can close this window; recording carries on until you stop it here."),
        h("div", { className: "actions" }, stop, discard),
      ),
    );
    return;
  }

  if (recorder.status === "starting") {
    regions.recorder.replaceChildren(h("section", { className: "panel" }, h("p", { className: "muted" }, "Starting the recorder")));
    return;
  }

  if (recorder.status === "saving") {
    const bar = h("div", { className: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": recorder.percent, "aria-label": "Upload progress" }, h("div", { className: "progress-fill", style: `width: ${recorder.percent}%` }));
    regions.recorder.replaceChildren(
      h("section", { className: "panel stack" },
        h("p", { className: "strong" }, "Saving to StudyScribe"),
        bar,
        h("p", { className: "muted small" }, "You can close this window. The upload continues in the background."),
      ),
    );
    return;
  }

  if (recorder.status === "saved") {
    regions.recorder.replaceChildren(
      h("div", { className: "notice notice-success", id: "record-result" },
        h("p", {}, h("span", { className: "strong" }, "Recording saved. "), "Transcription has started."),
        h("div", { className: "row" }, link("Open recording", `/recording/${recorder.recording.id}`), h("button", { className: "link-button", type: "button", onclick: (() => void send({ type: "record:discard" })) as EventListener }, "Dismiss")),
      ),
    );
    return;
  }

  if (recorder.status === "failed") {
    regions.recorder.replaceChildren(
      h("div", { className: "notice notice-error", role: "alert", id: "record-result" },
        h("p", {}, recorder.message),
        h("button", { className: "link-button", type: "button", onclick: (() => void send({ type: "record:discard" })) as EventListener }, "Dismiss"),
      ),
    );
    return;
  }
  regions.recorder.replaceChildren();
}

function renderImport(job: ImportState) {
  if (!regions) return;
  const dismiss = () => h("button", { className: "link-button", type: "button", onclick: (() => void send({ type: "import:clear" })) as EventListener }, "Dismiss");
  if (job.status === "importing") {
    regions.importStatus.replaceChildren(
      h("div", { className: "notice", id: "import-status" },
        h("p", {}, h("span", { className: "strong" }, "Importing this page. "), "Long videos can take a minute. You can close this window."),
      ),
    );
  } else if (job.status === "imported") {
    regions.importStatus.replaceChildren(
      h("div", { className: "notice notice-success", id: "import-status" },
        h("p", {}, h("span", { className: "strong" }, "Imported. "), "Transcription has started."),
        h("div", { className: "row" }, link("Open recording", `/recording/${job.recording.id}`), dismiss()),
      ),
    );
  } else if (job.status === "failed") {
    regions.importStatus.replaceChildren(
      h("div", { className: "notice notice-error", role: "alert", id: "import-status" }, h("p", {}, job.message), dismiss()),
    );
  } else {
    regions.importStatus.replaceChildren();
  }
}

function renderRecent(rows: RecordingSummary[] | null, error?: string) {
  if (!regions) return;
  const heading = h("div", { className: "section-heading" }, h("h2", {}, "Recent recordings"), link("Library", "/dashboard", "small"));
  if (error) {
    regions.recent.replaceChildren(heading, h("p", { className: "muted small" }, error));
    return;
  }
  if (!rows) {
    regions.recent.replaceChildren(heading, h("p", { className: "muted small" }, "Loading"));
    return;
  }
  if (rows.length === 0) {
    regions.recent.replaceChildren(heading, h("p", { className: "muted small" }, "Nothing yet. Recordings you make or import appear here."));
    return;
  }
  regions.recent.replaceChildren(
    heading,
    h(
      "ul",
      { className: "recent-list", id: "recent-list" },
      ...rows.map(row => {
        const meta = [formatRecordedDate(row.createdAt), formatDuration(row.duration), statusLabel(row.status)].filter(Boolean).join(" · ");
        return h("li", {},
          h("a", {
            href: siteUrl(origin, `/recording/${row.id}`),
            className: "recent-item",
            onclick: ((event: Event) => { event.preventDefault(); openSite(`/recording/${row.id}`); }) as EventListener,
          },
          h("span", { className: "recent-title clamp" }, row.title),
          h("span", { className: `recent-meta small ${row.status === "failed" ? "error" : "muted"}` }, meta)),
        );
      }),
    ),
  );
}

async function loadRecent() {
  renderRecent(null);
  try {
    renderRecent(await api.recentRecordings(5));
  } catch (error) {
    renderRecent(null, error instanceof ApiError ? error.message : "Recent recordings could not be loaded.");
  }
}

async function renderSignedIn(user: SessionUser) {
  const prefs = await getPrefs();
  regions = {
    capture: h("div", { className: "stack" }),
    form: buildForm(prefs),
    recorder: h("div", { className: "region" }),
    importStatus: h("div", { className: "region" }),
    recent: h("section", { className: "recent", "aria-label": "Recent recordings" }),
  };
  regions.capture.append(regions.recorder, regions.form, regions.importStatus);
  app.replaceChildren(
    regions.capture,
    regions.recent,
    h("footer", { className: "account muted small" }, "Signed in as ", h("span", { className: "strong", id: "account-email" }, user.email)),
  );
  renderRecorder(state.recorder);
  renderImport(state.importJob);
  void loadRecent();
}

let lastRecorderStatus = "";
let lastImportStatus = "";

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes.state?.newValue) return;
  const next = changes.state.newValue as StateResponse;
  const recorderChanged = JSON.stringify(next.recorder) !== JSON.stringify(state.recorder);
  const importChanged = JSON.stringify(next.importJob) !== JSON.stringify(state.importJob);
  state = next;
  // Ticks only move the clock, which the popup keeps itself; avoid rebuilding the panel every second.
  const onlyTicked = next.recorder.status === "recording" && lastRecorderStatus === "recording";
  if (recorderChanged && !onlyTicked) renderRecorder(next.recorder);
  if (importChanged) renderImport(next.importJob);
  if ((next.recorder.status === "saved" && lastRecorderStatus !== "saved") || (next.importJob.status === "imported" && lastImportStatus !== "imported")) {
    void loadRecent();
  }
  lastRecorderStatus = next.recorder.status;
  lastImportStatus = next.importJob.status;
});

async function boot() {
  app.replaceChildren(h("p", { className: "muted loading" }, "Checking your StudyScribe sign-in"));
  origin = await getOrigin();
  api = createApi(origin);
  // `popup.html?tab=<id>` opens the panel for a given tab when it is shown as a page (the end-to-end test does this).
  const requestedTab = Number(new URLSearchParams(location.search).get("tab"));
  tab = Number.isInteger(requestedTab) && requestedTab > 0
    ? await chrome.tabs.get(requestedTab).catch(() => undefined)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  state = await send<StateResponse>({ type: "state" });
  lastRecorderStatus = state.recorder.status;
  lastImportStatus = state.importJob.status;
  let user: SessionUser | null;
  try {
    user = await api.me();
  } catch (error) {
    renderUnreachable(error instanceof Error ? error.message : "Try again in a moment.");
    return;
  }
  if (!user) {
    renderSignedOut();
    return;
  }
  await renderSignedIn(user);
}

document.getElementById("settings-button")!.addEventListener("click", () => void chrome.runtime.openOptionsPage());
document.getElementById("brand-link")!.addEventListener("click", event => {
  event.preventDefault();
  openSite("/dashboard");
});

void boot();
