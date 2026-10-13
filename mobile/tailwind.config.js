/** Tailwind (NativeWind) config. Class names mean the same as on the web: tokens come from src/global.css. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        card: { DEFAULT: token("card"), foreground: token("card-foreground") },
        primary: { DEFAULT: token("primary"), foreground: token("primary-foreground") },
        secondary: { DEFAULT: token("secondary"), foreground: token("secondary-foreground") },
        muted: { DEFAULT: token("muted"), foreground: token("muted-foreground") },
        accent: { DEFAULT: token("accent"), foreground: token("accent-foreground") },
        destructive: { DEFAULT: token("destructive"), foreground: token("destructive-foreground") },
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        annotation: token("annotation"),
        brand: { sky: token("brand-sky"), deep: token("brand-deep"), mist: token("brand-mist") },
        course: {
          blue: token("course-blue"),
          teal: token("course-teal"),
          green: token("course-green"),
          amber: token("course-amber"),
          rose: token("course-rose"),
          violet: token("course-violet"),
          slate: token("course-slate"),
        },
      },
      // --radius is 1rem on the web: sm 12, md 14, lg 16, xl 20.
      borderRadius: { sm: "12px", md: "14px", lg: "16px", xl: "20px" },
      fontFamily: {
        sans: ["Geist_400Regular"],
        medium: ["Geist_500Medium"],
        semibold: ["Geist_600SemiBold"],
        bold: ["Geist_700Bold"],
      },
    },
  },
  plugins: [],
};
