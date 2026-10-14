import * as WebBrowser from "expo-web-browser";
import { WEB_URL } from "./config";

/** Opens a page of the web app (legal pages, help, billing) in the in-app browser. */
export function openWebPage(path: string) {
  return WebBrowser.openBrowserAsync(`${WEB_URL}${path}`, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }).catch(() => undefined);
}
