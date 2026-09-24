import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg)",
        panel: "var(--surface)",
        raised: "var(--surface-raised)",
        line: "var(--line)",
        ink: "var(--text)",
        quiet: "var(--muted)",
        peach: "var(--accent)",
        danger: "var(--danger)",
        success: "var(--success)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        panel: "0 14px 36px rgba(0, 0, 0, .24)",
        lift: "0 18px 44px rgba(0, 0, 0, .34)",
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "10px",
        lg: "14px",
        xl: "18px",
        "2xl": "24px",
      },
    },
  },
  plugins: [],
};

export default config;
