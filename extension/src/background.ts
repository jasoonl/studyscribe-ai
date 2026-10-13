import { createApi } from "./lib/api";
import { isFromThisExtension, parseMessage, type CommandResponse, type StateResponse } from "./lib/messages";
import { getOrigin } from "./lib/settings";
import { createWorker } from "./lib/worker";

const OFFSCREEN_PATH = "offscreen.html";
const STATE_KEY = "state";
const BADGE_COLOR = "#3446D9";

let creatingOffscreen: Promise<void> | null = null;

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Records the tab's audio, and the microphone when asked, while the popup is closed.",
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

async function closeOffscreen(): Promise<void> {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
}

const worker = createWorker({
  getOrigin,
  api: origin => createApi(origin),
  load: async () => {
    const stored = await chrome.storage.session.get(STATE_KEY);
    return (stored[STATE_KEY] as Partial<StateResponse> | undefined) ?? {};
  },
  save: state => chrome.storage.session.set({ [STATE_KEY]: state }),
  getTabStreamId: tabId => chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }),
  ensureOffscreen,
  closeOffscreen,
  sendToOffscreen: command => chrome.runtime.sendMessage<typeof command, CommandResponse>(command),
  setBadge: async (text, title) => {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    await chrome.action.setBadgeText({ text });
    await chrome.action.setTitle({ title });
  },
  keepAlive: () => {
    // An extension API call every 20s resets the worker's 30s idle timer while a long import runs.
    const timer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
    return () => clearInterval(timer);
  },
  now: () => Date.now(),
});

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (!isFromThisExtension(sender, chrome.runtime.id)) return false;
  const message = parseMessage(raw);
  if (!message || message.type.startsWith("offscreen:")) return false;
  worker.handle(message).then(sendResponse, error => sendResponse({ ok: false, error: String(error?.message ?? error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === "install") void chrome.runtime.openOptionsPage();
});
