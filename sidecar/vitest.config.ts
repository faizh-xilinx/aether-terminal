import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: true,
    environment: "node",
  },
  // Pin an empty PostCSS config so vite doesn't walk up the tree and
  // try to load the *frontend's* postcss.config.js (which depends on
  // tailwindcss — not part of the sidecar's node_modules). This caused
  // the sidecar test job to fail on a clean CI runner.
  css: {
    postcss: { plugins: [] },
  },
});
