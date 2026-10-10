import type { Config } from "tailwindcss";

/**
 * Monad Light palette. Every color used by the UI comes from these tokens.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        monad: {
          bg: "#F7F5FE", // page background (soft lavender tint)
          surface: "#FFFFFF", // cards and surfaces
          border: "#DDD6FE", // soft card border
          primary: "#836EF9", // brand purple: buttons, active states, badges
          deep: "#5E43F3", // hover states and primary typography accents
          ink: "#1C1536", // headings and strong text
          muted: "#6B6188", // muted labels
          tint: "#EFEBFE", // light wash for selected / hover surfaces
        },
        // Status indicators. The base hues (#10B981 / #EF4444) are used for dots, icons and borders;
        // the *Ink shades are for small text on the tinted backgrounds so it stays readable (WCAG AA).
        status: {
          active: "#10B981", // Verified / Active / Completed
          activeInk: "#047857",
          activeBg: "#ECFDF5",
          danger: "#EF4444", // Expired / Cancelled / Declined
          dangerInk: "#B91C1C",
          dangerBg: "#FEF2F2",
          warn: "#B7791F", // Unverified collection
          warnBg: "#FEF3C7",
        },
        // The one warm note: MON, the only thing in a trade that is not an NFT.
        coin: { DEFAULT: "#F5B544", ink: "#8A5A00", bg: "#FFF6E0" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(94, 67, 243, 0.06), 0 8px 24px -8px rgba(94, 67, 243, 0.14)",
        lift: "0 2px 4px rgba(94, 67, 243, 0.08), 0 14px 32px -10px rgba(94, 67, 243, 0.28)",
        glow: "0 0 0 1px rgba(131,110,249,0.18), 0 24px 80px -20px rgba(131,110,249,0.45), 0 8px 24px -12px rgba(94,67,243,0.25)",
      },
      borderRadius: { card: "20px" },
      fontFamily: {
        // Display: Bricolage Grotesque (wide, slightly quirky: fits a mascot-led community).
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      backgroundImage: {
        // The brief's page wash: lavender -> white -> lavender.
        page: "linear-gradient(to bottom, #F7F5FE, #FFFFFF 45%, #F1EEFE)",
        violet: "linear-gradient(135deg, #836EF9 0%, #5E43F3 100%)",
        "violet-soft": "linear-gradient(135deg, rgba(131,110,249,0.16), rgba(94,67,243,0.06))",
      },
      keyframes: {
        // The hero trade: two cards exchange places on an arc, rest, then swap back.
        "swap-a": {
          "0%, 30%": { transform: "translate(0, 0) rotate(-7deg)" },
          "40%": { transform: "translate(calc(var(--dx) * 0.5), -34px) rotate(0deg)" },
          "50%, 80%": { transform: "translate(var(--dx), 0) rotate(6deg)" },
          "90%": { transform: "translate(calc(var(--dx) * 0.5), -34px) rotate(0deg)" },
          "100%": { transform: "translate(0, 0) rotate(-7deg)" },
        },
        "swap-b": {
          "0%, 30%": { transform: "translate(0, 0) rotate(6deg)" },
          "40%": { transform: "translate(calc(var(--dx) * -0.5), 34px) rotate(0deg)" },
          "50%, 80%": { transform: "translate(calc(var(--dx) * -1), 0) rotate(-7deg)" },
          "90%": { transform: "translate(calc(var(--dx) * -0.5), 34px) rotate(0deg)" },
          "100%": { transform: "translate(0, 0) rotate(6deg)" },
        },
        "settle-chip": {
          "0%, 38%": { opacity: "0", transform: "translateY(6px) scale(0.96)" },
          "46%, 78%": { opacity: "1", transform: "translateY(0) scale(1)" },
          "88%, 100%": { opacity: "0", transform: "translateY(-4px) scale(0.98)" },
        },
        "coin-bob": { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-8px)" } },
        shimmer: { "0%": { transform: "translateX(0)" }, "100%": { transform: "translateX(400%)" } },
        "fade-up": { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "spin-slow": { to: { transform: "rotate(360deg)" } },
        "spin-rev": { to: { transform: "rotate(-360deg)" } },
        float: { "0%, 100%": { transform: "translateY(0) rotate(var(--r, 0deg))" }, "50%": { transform: "translateY(var(--fy, -14px)) rotate(calc(var(--r, 0deg) * -0.6))" } },
        marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        "marquee-rev": { from: { transform: "translateX(-50%)" }, to: { transform: "translateX(0)" } },
        twinkle: { "0%, 100%": { opacity: "0.15", transform: "scale(0.7)" }, "50%": { opacity: "1", transform: "scale(1.15)" } },
        aurora: { "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" }, "50%": { transform: "translate3d(4%, -6%, 0) scale(1.12)" } },
        sheen: { from: { backgroundPosition: "-200% 0" }, to: { backgroundPosition: "200% 0" } },
        "pulse-dot": { "0%": { boxShadow: "0 0 0 0 rgba(16,185,129,0.45)" }, "100%": { boxShadow: "0 0 0 8px rgba(16,185,129,0)" } },
      },
      animation: {
        "swap-a": "swap-a 9s cubic-bezier(.45,.05,.25,1) infinite",
        "swap-b": "swap-b 9s cubic-bezier(.45,.05,.25,1) infinite",
        "settle-chip": "settle-chip 9s ease-in-out infinite",
        "coin-bob": "coin-bob 3.2s ease-in-out infinite",
        "fade-up": "fade-up .6s cubic-bezier(.2,.7,.2,1) both",
        "pulse-dot": "pulse-dot 1.8s ease-out infinite",
        "spin-slow": "spin-slow 40s linear infinite",
        "spin-rev": "spin-rev 60s linear infinite",
        float: "float var(--dur, 7s) ease-in-out infinite",
        marquee: "marquee 60s linear infinite",
        "marquee-rev": "marquee-rev 70s linear infinite",
        twinkle: "twinkle var(--dur, 3.5s) ease-in-out infinite",
        aurora: "aurora 16s ease-in-out infinite",
        sheen: "sheen 6s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
