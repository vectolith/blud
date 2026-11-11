import { getAuthSession } from "@db/services/auth/session";
import {
  createGitHubAuthorizationAttempt,
} from "@db/services/integrations/github";
import {
  getIntegrationCredentialKeyring,
} from "../../../../../integrations/credential-keyring";
import {
  buildGitHubAuthorizationUrl,
} from "../../../../../integrations/github/oauth";
import { env } from "@shared/environment";
import { applicationOrigin } from "@shared/environment/origin";

const privateHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
};

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  let appOrigin: string;
  try {
    appOrigin = applicationOrigin();
  } catch {
    return new Response("Integration authorization is unavailable.", {
      status: 503,
      headers: privateHeaders,
    });
  }

  if (origin !== appOrigin) {
    return new Response("Invalid request origin.", {
      status: 403,
      headers: privateHeaders,
    });
  }

  const session = await getAuthSession(request.headers);
  if (!session) {
    return new Response("Sign in to connect GitHub.", {
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

  try {
    const redirectUri = new URL(
      "/api/integrations/github/callback",
      appOrigin
    ).href;
    const keyring = await getIntegrationCredentialKeyring();
    const attempt = await createGitHubAuthorizationAttempt({
      ownerUserId: session.user.id,
      redirectUri,
      keyring,
    });
    const authorizationUrl = buildGitHubAuthorizationUrl({
      clientId: GITHUB_APP_CLIENT_ID,
      redirectUri,
      state: attempt.state,
      codeChallenge: attempt.codeChallenge,
    });

    return new Response(null, {
      status: 303,
      headers: { ...privateHeaders, location: authorizationUrl.href },
    });
  } catch {
    return new Response("GitHub authorization could not be started.", {
      status: 503,
      headers: privateHeaders,
    });
  }
}
