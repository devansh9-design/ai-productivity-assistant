import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";
import defaultTheme from "tailwindcss/defaultTheme";
import plugin from "tailwindcss/plugin";

/**
 * Light and dark themes from one set of class names. Every colour the app
 * uses is a CSS variable: light mode keeps Tailwind's own values, and the
 * `.dark` class on <html> swaps in dark ones, so "bg-white text-slate-900"
 * becomes a dark card with light text without a `dark:` variant on each class.
 *
 * - slate (and white, the card surface) uses DARK_NEUTRAL: a navy scale in the
 *   style of the Tokyo Night editor theme, light shades becoming dark ones.
 * - Accent colours keep their solid 400-600 shades (buttons, dots, bars),
 *   turn their tints (50-300) into subtle blends over the dark surface, and
 *   mirror their text shades (700-950) to light ones.
 * Solid 700/800 accent backgrounds used only for hover are fixed up in
 * globals.css.
 */
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
type Shade = (typeof SHADES)[number];
/**
 * Dark values for each slate shade, by role: 50 is the page, white (below) the
 * cards, 100 hovers and tracks, 200-300 borders, 400-600 icons and muted to
 * secondary text, 700-950 body text up to headings.
 */
const DARK_NEUTRAL: Record<Shade, string> = {
  50: "#16161e", 100: "#24283b", 200: "#292e42", 300: "#3b4261", 400: "#565f89", 500: "#737aa2",
  600: "#a9b1d6", 700: "#c0caf5", 800: "#cfd5f7", 900: "#dfe3fb", 950: "#eef0fd",
};
/** Dark card surface (Tailwind "white"). */
const DARK_SURFACE = "#1a1b26";
const ACCENT_MIRROR: Record<Shade, Shade> = { 50: "950", 100: "900", 200: "800", 300: "700", 400: "400", 500: "500", 600: "600", 700: "300", 800: "200", 900: "100", 950: "50" };
const ACCENTS = ["indigo", "rose", "emerald", "amber", "blue", "violet", "sky", "yellow"] as const;
const THEMED = ["slate", ...ACCENTS] as const;

function channels(hex: string): number[] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
}

/** "#4f46e5" -> "79 70 229", the form Tailwind's <alpha-value> needs. */
function rgb(hex: string): string {
  return channels(hex).join(" ");
}

/** `amount` of `hex` over `base`, as an "r g b" triplet. */
function mix(hex: string, base: string, amount: number): string {
  const top = channels(hex);
  return channels(base).map((value, index) => Math.round(value + (top[index] - value) * amount)).join(" ");
}

/**
 * Dark-theme tints (alert, badge and block backgrounds and their borders):
 * a little of the accent over the dark card surface, instead of the accent's
 * own very dark shades, which read as heavy coloured slabs.
 */
const DARK_TINTS: Partial<Record<Shade, { from: Shade; amount: number }>> = {
  50: { from: "500", amount: 0.12 },
  100: { from: "500", amount: 0.2 },
  200: { from: "500", amount: 0.35 },
  300: { from: "400", amount: 0.55 },
};

const palette = (name: (typeof THEMED)[number]) => colors[name] as Record<Shade, string>;

const themedColors = Object.fromEntries(THEMED.map((name) => [
  name,
  Object.fromEntries(SHADES.map((shade) => [shade, `rgb(var(--${name}-${shade}) / <alpha-value>)`])),
]));

const themeVariables = plugin(({ addBase }) => {
  const light: Record<string, string> = { "--white": "255 255 255" };
  const dark: Record<string, string> = { "--white": rgb(DARK_SURFACE) };
  for (const name of THEMED) {
    for (const shade of SHADES) {
      light[`--${name}-${shade}`] = rgb(palette(name)[shade]);
      const tint = DARK_TINTS[shade];
      dark[`--${name}-${shade}`] = name === "slate"
        ? rgb(DARK_NEUTRAL[shade])
        : tint
          ? mix(palette(name)[tint.from], DARK_SURFACE, tint.amount)
          : rgb(palette(name)[ACCENT_MIRROR[shade]]);
    }
  }
  addBase({ ":root": light, ".dark": dark });
});

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: { sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans] },
      colors: { white: "rgb(var(--white) / <alpha-value>)", ...themedColors },
    },
  },
  plugins: [themeVariables],
};

export default config;
