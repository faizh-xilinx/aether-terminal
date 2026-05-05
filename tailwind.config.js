/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "JetBrains Mono",
          "MonoLisa",
          "Berkeley Mono",
          "Cascadia Code",
          "Fira Code",
          "ui-monospace",
          "SFMono-Regular",
          "Consolas",
          "monospace",
        ],
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        bg: {
          DEFAULT: "rgb(var(--ae-bg) / <alpha-value>)",
          subtle: "rgb(var(--ae-bg-subtle) / <alpha-value>)",
          elevated: "rgb(var(--ae-bg-elevated) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--ae-fg) / <alpha-value>)",
          muted: "rgb(var(--ae-fg-muted) / <alpha-value>)",
          subtle: "rgb(var(--ae-fg-subtle) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--ae-accent) / <alpha-value>)",
          fg: "rgb(var(--ae-accent-fg) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--ae-border) / <alpha-value>)",
          strong: "rgb(var(--ae-border-strong) / <alpha-value>)",
        },
        success: "rgb(var(--ae-success) / <alpha-value>)",
        warn: "rgb(var(--ae-warn) / <alpha-value>)",
        danger: "rgb(var(--ae-danger) / <alpha-value>)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--ae-accent) / 0.3), 0 8px 32px rgb(var(--ae-accent) / 0.15)",
        panel: "0 12px 48px rgb(0 0 0 / 0.4)",
      },
      animation: {
        "fade-in": "fadeIn 120ms ease-out",
        "slide-up": "slideUp 160ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
