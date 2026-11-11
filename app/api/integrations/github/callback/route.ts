import { getAuthSession } from "@db/services/auth/session";
import {
  consumeGitHubAuthorizationAttempt,
  failGitHubAuthorizationAttempt,
  saveGitHubConnection,
} from "@db/services/integrations/github";
import { getIntegrationCredentialKeyring } from "../../../../../integrations/credential-keyring";
import {
  exchangeGitHubAuthorizationCode,
  fetchGitHubAccount,
} from "../../../../../integrations/github/oauth";
import { env } from "@shared/environment";
import { applicationOrigin } from "@shared/environment/origin";

const privateHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
};

function finish(status: "connected" | "error") {
  const destination = new URL("/settings/integrations", applicationOrigin());
  destination.searchParams.set("github", status);
  return new Response(null, {
    status: 303,
    headers: { ...privateHeaders, location: destination.href },
  });
}

export async function GET(request: Request) {
  let appOrigin: string;
  try {
    appOrigin = applicationOrigin();
  } catch {
    return new Response("Integration callback is unavailable.", {
      status: 503,
      headers: privateHeaders,
    });
  }

  const session = await getAuthSession(request.headers);
  if (!session) {
    return new Response("Sign in again to finish connecting GitHub.", {
      status: 401,
      headers: privateHeaders,
    });
  }

  const { GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET } = env;
  if (!GITHUB_APP_CLIENT_ID || !GITHUB_APP_CLIENT_SECRET) {
    return new Response("GitHub integration is not configured.", {
      status: 503,
      headers: privateHeaders,
    });
  }

  const callbackUrl = new URL(request.url);
  const state = callbackUrl.searchParams.get("state") ?? "";
  const code = callbackUrl.searchParams.get("code") ?? "";
  const providerError = callbackUrl.searchParams.get("error");
  if (!state) return finish("error");

  let attemptId: string | undefined;
  try {
    const keyring = await getIntegrationCredentialKeyring();
    const attempt = await consumeGitHubAuthorizationAttempt({
      ownerUserId: session.user.id,
      state,
      keyring,
    });
    if (!attempt) return finish("error");
    attemptId = attempt.id;

    if (providerError || !code || code.length > 2048) {
      await failGitHubAuthorizationAttempt({
        ownerUserId: session.user.id,
        attemptId,
      });
      return finish("error");
    }

    const expectedRedirectUri = new URL(
      "/api/integrations/github/callback",
      appOrigin
    ).href;
    if (attempt.redirectUri !== expectedRedirectUri) {
      await failGitHubAuthorizationAttempt({
        ownerUserId: session.user.id,
        attemptId,
      });
      return finish("error");
    }

    const token = await exchangeGitHubAuthorizationCode({
      clientId: GITHUB_APP_CLIENT_ID,
      clientSecret: GITHUB_APP_CLIENT_SECRET,
      code,
      redirectUri: attempt.redirectUri,
      codeVerifier: attempt.codeVerifier,
    });
    const account = await fetchGitHubAccount(token.access_token);
    await saveGitHubConnection({
      ownerUserId: session.user.id,
      account,
      token,
      keyring,
    });
    return finish("connected");
  } catch {
    if (attemptId) {
      try {
        await failGitHubAuthorizationAttempt({
          ownerUserId: session.user.id,
          attemptId,
        });
      } catch {
        // Do not replace the generic callback failure with a persistence error.
      }
    }
    return finish("error");
  }
}
