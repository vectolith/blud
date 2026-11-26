import { env } from "@shared/environment";

export function applicationOrigin() {
  if (env.BETTER_AUTH_URL) return new URL(env.BETTER_AUTH_URL).origin;

  throw new Error(
    "The application origin is unavailable. Set BETTER_AUTH_URL to the public URL of this deployment."
  );
}

export function betterAuthBaseURL() {
  return applicationOrigin();
}
