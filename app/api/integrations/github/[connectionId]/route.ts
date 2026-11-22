import { z } from "zod";
import { getAuthSession } from "@db/services/auth/session";
import { revokeGitHubConnection } from "@db/services/integrations/github";
import { getIntegrationCredentialKeyring } from "../../../../../integrations/credential-keyring";
import { env } from "@shared/environment";
import { applicationOrigin } from "@shared/environment/origin";

const privateHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
};

export async function DELETE(
  request: Request,
  context: { params: Promise<{ connectionId: string }> }
) {
  let appOrigin: string;
  try {
    appOrigin = applicationOrigin();
  } catch {
    return Response.json(
      { error: "Integration disconnection is unavailable." },
      { status: 503, headers: privateHeaders }
    );
  }

  if (request.headers.get("origin") !== appOrigin) {
    return Response.json(
      { error: "Invalid request origin." },
      { status: 403, headers: privateHeaders }
    );
  }

  const session = await getAuthSession(request.headers);
  if (!session) {
    return Response.json(
      { error: "Sign in to disconnect GitHub." },
      { status: 401, headers: privateHeaders }
    );
  }

  const { connectionId } = await context.params;
  if (!z.uuid().safeParse(connectionId).success) {
    return Response.json(
      { error: "GitHub connection was not found." },
      { status: 404, headers: privateHeaders }
    );
  }

  try {
    const result = await revokeGitHubConnection({
      ownerUserId: session.user.id,
      connectionId,
      keyring: await getIntegrationCredentialKeyring(),
      clientId: env.GITHUB_APP_CLIENT_ID,
      clientSecret: env.GITHUB_APP_CLIENT_SECRET,
    });
    if (!result.found) {
      return Response.json(
        { error: "GitHub connection was not found." },
        { status: 404, headers: privateHeaders }
      );
    }
    return Response.json(
      {
        provider: "github",
        status: "revoked",
        remoteRevoked: result.remoteRevoked,
      },
      { headers: privateHeaders }
    );
  } catch {
    return Response.json(
      { error: "GitHub connection could not be disconnected." },
      { status: 503, headers: privateHeaders }
    );
  }
}
