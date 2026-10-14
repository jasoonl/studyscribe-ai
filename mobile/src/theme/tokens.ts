import { useColorScheme } from "react-native";
import type { CourseColorKey } from "@shared/courseColors";

/**
 * The web's design tokens (client/src/index.css) in JS, for the places class
 * names cannot reach: icon colours, the navigation theme, the status bar.
 * src/global.css holds the same values as CSS variables for NativeWind.
 */

const light = {
  background: "#f8fafd",
  foreground: "#0a152a",
  card: "#ffffff",
  primary: "#2154d8",
  primaryForeground: "#f8fafd",
  secondary: "#e6f2fe",
  secondaryForeground: "#122750",
  muted: "#eaf1f8",
  mutedForeground: "#505f74",
  accent: "#0077b2",
  destructive: "#e7000b",
  border: "#d9e2ed",
  ring: "#0089d0",
  brandSky: "#22b5e1",
  brandDeep: "#112c6f",
  brandMist: "#e8f3ff",
  success: "#4a9a5e",
  course: {
    blue: "#366bd3",
    teal: "#1d9999",
    green: "#4a9a5e",
    amber: "#d49838",
    rose: "#d8516a",
    violet: "#885acb",
    slate: "#667383",
  } satisfies Record<CourseColorKey, string>,
};

const dark: typeof light = {
  background: "#070d1a",
  foreground: "#e5ecf3",
  card: "#0d1626",
  primary: "#427ff7",
  primaryForeground: "#f8fafd",
  secondary: "#192437",
  secondaryForeground: "#d4dfeb",
  muted: "#1b2435",
  mutedForeground: "#98a6b8",
  accent: "#1a2e4c",
  destructive: "#ff6467",
  border: "#1e2837",
  ring: "#3c8ff4",
  brandSky: "#49c1ea",
  brandDeep: "#09183b",
  brandMist: "#151f32",
  success: "#69ba7c",
  course: {
    blue: "#6496f4",
    teal: "#49b8b8",
    green: "#69ba7c",
    amber: "#e8b45e",
    rose: "#ec7385",
    violet: "#ad87ed",
    slate: "#92a0b1",
  },
};

export const palette = { light, dark };
export type Palette = typeof light;

export function useTheme(): Palette & { scheme: "light" | "dark" } {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { ...palette[scheme], scheme };
}

/** Spacing scale used across screens (matches Tailwind's 4px steps). */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;
