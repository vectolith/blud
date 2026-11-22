import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const applicationEnvironment = [
  "BETTER_AUTH_*",
  "BLUD_INTERNAL_KEY",
  "GITHUB_APP_*",
  "BLOB_*",
  "DATABASE_URL",
  "EVE_NEXT_*",
  "*_CONNECTOR_UID",
  "KERNEL_*",
  "LINQ_*",
  "LINK_*",
  "NODE_ENV",
  "SECRET_ENCRYPTION_KEY",
  "SKIP_ENV_VALIDATION",
  "STRIPE_PUBLISHABLE_KEY",
  "VERCEL_*",
];
const runtimeEnvironment = applicationEnvironment.filter(
  (value) => value !== "EVE_NEXT_*" && value !== "SKIP_ENV_VALIDATION"
);

describe("Turbo configuration", () => {
  it("scopes application environment variables to their owning tasks", async () => {
    const turbo = z.object({
      tasks: z.object({
        "build:app": z.object({ env: z.array(z.string()) }),
        "dev:app": z.object({ passThroughEnv: z.array(z.string()) }),
        "lint:app": z.object({ env: z.array(z.string()) }),
        "test:app": z.object({ env: z.array(z.string()) }),
        "start:app": z.object({ passThroughEnv: z.array(z.string()) }),
      }),
    }).loose().parse(JSON.parse(await readFile(new URL("../turbo.json", import.meta.url), "utf8")));

    expect(turbo).not.toHaveProperty("globalEnv");
    expect(turbo.tasks["build:app"].env).toEqual(expect.arrayContaining(applicationEnvironment));
    expect(turbo.tasks["build:app"].env).toHaveLength(applicationEnvironment.length);
    expect(turbo.tasks["dev:app"].passThroughEnv).toEqual(runtimeEnvironment);
    expect(turbo.tasks["start:app"].passThroughEnv).toEqual(runtimeEnvironment);
    expect(turbo.tasks["lint:app"].env).not.toContain("VELNOR_SHARED_SECRET");
    expect(turbo.tasks["test:app"].env).not.toContain("VELNOR_SHARED_SECRET");
  });

  it("uses provider-neutral package build and migration commands", async () => {
    const manifest = z.object({
      scripts: z.record(z.string(), z.string()),
      dependencies: z.record(z.string(), z.string()).optional(),
      devDependencies: z.record(z.string(), z.string()).optional(),
    }).parse(JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")));
    const turbo = JSON.parse(await readFile(new URL("../turbo.json", import.meta.url), "utf8"));

    expect(manifest.scripts.build).toBe("turbo run build:app");
    expect(manifest.scripts["build:app"]).toBe("next build");
    expect(manifest.scripts).not.toHaveProperty("build:vercel");
    expect(turbo.tasks).not.toHaveProperty("build:vercel");
    expect(manifest.dependencies).not.toHaveProperty("@vercel/blob");
    expect(manifest.devDependencies).not.toHaveProperty("vercel");
  });
});
