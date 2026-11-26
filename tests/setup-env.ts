import { vi } from "vitest";

const testEnvironment = {
  BETTER_AUTH_SECRET: "test-auth-secret-0123456789abcdefghijklmnop",
  BLUD_INTERNAL_KEY: "test-internal-key-0123456789abcdefghijklmnop",
  BETTER_AUTH_URL: "https://example.com",
  // The integration suite signs phone users in without an SMS provider.
  BLUD_ALLOW_LOCAL_PHONE_AUTH_BYPASS: "true",
  S3_BUCKET: "blud-artifacts-test",
  DATABASE_URL: "postgresql://user:password@example.com/database",
  KERNEL_API_KEY: "test-kernel-key",
  SECRET_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
};

for (const [name, value] of Object.entries(testEnvironment)) {
  vi.stubEnv(name, value);
}
