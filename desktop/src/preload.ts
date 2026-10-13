import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { systemAudioSupport, type SystemAudioSupport } from "./lib/systemAudio";

/**
 * The bridge the web app sees as `window.studyscribeDesktop`. It exposes a
 * few named functions, never ipcRenderer itself, and the main process checks
 * that each call comes from the StudyScribe origin.
 *
 * System audio needs nothing from the page: the record page's existing
 * "Add tab or screen audio" calls getDisplayMedia, and the main process
 * answers it with the computer's audio. `systemAudio` tells the page (or a
 * future desktop-aware label) that this is what the button will capture.
 */
export type DesktopBridge = {
  isDesktop: true;
  platform: string;
  systemAudio: SystemAudioSupport;
  getInfo(): Promise<{ appVersion: string; origin: string; systemAudio: SystemAudioSupport; studyHelp: boolean } | null>;
  /** Turns the compact, always-on-top Study help window on or off (toggles without an argument). */
  setStudyHelp(on?: boolean): Promise<boolean>;
  onStudyHelpChange(listener: (on: boolean) => void): () => void;
  retry(): void;
};

const bridge: DesktopBridge = {
  isDesktop: true,
  platform: process.platform,
  systemAudio: systemAudioSupport(process.platform),
  getInfo: () => ipcRenderer.invoke("desktop:info"),
  setStudyHelp: on => ipcRenderer.invoke("desktop:study-help", on),
  onStudyHelpChange: listener => {
    const handler = (_event: IpcRendererEvent, on: unknown) => listener(on === true);
    ipcRenderer.on("desktop:study-help", handler);
    return () => ipcRenderer.removeListener("desktop:study-help", handler);
  },
  retry: () => void ipcRenderer.invoke("desktop:retry"),
};

contextBridge.exposeInMainWorld("studyscribeDesktop", bridge);
