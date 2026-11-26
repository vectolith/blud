import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const applicationEnvironment = [
  "BETTER_AUTH_*",
  "BLUD_INTERNAL_KEY",
  "GITHUB_APP_*",
  "S3_*",
  "DATABASE_URL",
  "*_CONNECTOR_UID",
  "KERNEL_*",
  "LINK_*",
  "NODE_ENV",
  "SECRET_ENCRYPTION_KEY",
  "SENDBLUE_*",
  "SKIP_ENV_VALIDATION",
  "STRIPE_PUBLISHABLE_KEY",
];
const runtimeEnvironment = [
  "BETTER_AUTH_*",
  "BLUD_INTERNAL_KEY",
  "GITHUB_APP_*",
  "S3_*",
  "DATABASE_URL",
  "*_CONNECTOR_UID",
  "KERNEL_*",
  "LINK_*",
  "NODE_ENV",
  "SECRET_ENCRYPTION_KEY",
  "SENDBLUE_*",
  "STRIPE_PUBLISHABLE_KEY",
];

describe("Turbo configuration", () => {
  it("scopes application environment variables to their owning tasks", async () => {
    const turbo = z
      .object({
        tasks: z.object({
          "build:app": z.object({ env: z.array(z.string()) }),
          "dev:app": z.object({ passThroughEnv: z.array(z.string()) }),
          "lint:app": z.object({ env: z.array(z.string()) }),
          "test:app": z.object({ env: z.array(z.string()) }),
          "start:app": z.object({ passThroughEnv: z.array(z.string()) }),
        }),
      })
      .loose()
      .parse(
        JSON.parse(
          await readFile(new URL("../turbo.json", import.meta.url), "utf8")
        )
      );

    expect(turbo).not.toHaveProperty("globalEnv");
    expect(turbo.tasks["build:app"].env).toEqual(
      expect.arrayContaining([...applicationEnvironment, "EVE_NEXT_*"])
    );
    expect(turbo.tasks["build:app"].env).toHaveLength(
      applicationEnvironment.length + 1
    );
    expect(turbo.tasks["dev:app"].passThroughEnv).toEqual(runtimeEnvironment);
    expect(turbo.tasks["start:app"].passThroughEnv).toEqual(runtimeEnvironment);
    expect(turbo.tasks["lint:app"].env).not.toContain("VELNOR_SHARED_SECRET");
    expect(turbo.tasks["test:app"].env).not.toContain("VELNOR_SHARED_SECRET");
  });
});
