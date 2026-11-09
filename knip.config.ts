import type { KnipConfig } from "knip";

export default {
  entry: [
    "agent/channels/**/*.ts",
    "agent/extensions/**/*.ts",
    "agent/hooks/**/*.ts",
    "agent/instructions/**/*.ts",
    "agent/instrumentation/**/*.ts",
    "agent/memory/**/*.ts",
    "agent/subagents/**/*.ts",
    "agent/schedules/**/*.ts",
    "agent/tools/**/*.ts",
    "db/drizzle.config.ts",
    // Drizzle consumes every table and relation exported by this schema barrel.
    "db/schema/index.ts",
    "evals/**/*.eval.ts",
    "evals/evals.config.ts",
    "taze.config.ts",
    "tests/runtime/fixture/agent/**/*.ts",
    "tests/runtime/fixture/evals/**/*.ts",
  ],
  ignoreDependencies: [
    // Imported through the owning Tailwind stylesheet rather than TypeScript.
    "@tailwindcss/postcss",
    "shadcn",
    "tailwindcss",
    "use-stick-to-bottom",
    // Loaded as jsPlugins from .oxlintrc.jsonc rather than TypeScript.
    "eslint-plugin-react-hooks",
    "eslint-plugin-turbo",
    "oxlint-tailwindcss",
    // Invoked as a CLI.
    "vercel",
  ],
  ignoreIssues: {
    // Headless messaging mode retains shared web/trpc/auth/component primitives without mounting web UI pages.
    "db/services/**/*.ts": ["exports", "types"],
    "shared/**/*.ts": ["exports", "files", "types"],
    "web/**/*.{ts,tsx}": ["exports", "files", "types"],
  },
  project: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
} satisfies KnipConfig;
