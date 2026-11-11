import { z } from "zod";
import { getAuthSession } from "@db/services/auth/session";
import { getFreshGitHubAccessToken } from "@db/services/integrations/github";
import { env } from "@shared/environment";
import { getIntegrationCredentialKeyring } from "../../../../../../../integrations/credential-keyring";
import {
  GitHubInstallationApiError,
  listGitHubInstallationRepositories,
} from "../../../../../../../integrations/github/installations";

const privateHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
};

const querySchema = z.object({
  connectionId: z.uuid(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const installationIdSchema = z.string().regex(/^[1-9]\d{0,19}$/u);

export async function GET(
  request: Request,
  context: {
    params: Promise<{ installationId: string }>;
  }
) {
  const session = await getAuthSession(request.headers);
  if (!session) {
    return Response.json(
      { error: "Sign in to view GitHub repositories." },
      { status: 401, headers: privateHeaders }
    );
  }

  const { installationId: rawInstallationId } = await context.params;
  const parsedInstallationId =
    installationIdSchema.safeParse(rawInstallationId);
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsedInstallationId.success || !query.success) {
    return Response.json(
      {
        error: "A valid GitHub installation, connection, and page are required.",
      },
      { status: 400, headers: privateHeaders }
    );
  }

  const { GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET } = env;
  if (!GITHUB_APP_CLIENT_ID || !GITHUB_APP_CLIENT_SECRET) {
    return Response.json(
      { error: "GitHub integration is not configured." },
      { status: 503, headers: privateHeaders }
    );
  }

  try {
    const keyring = await getIntegrationCredentialKeyring();
    const accessToken = await getFreshGitHubAccessToken({
      ownerUserId: session.user.id,
      connectionId: query.data.connectionId,
      clientId: GITHUB_APP_CLIENT_ID,
      clientSecret: GITHUB_APP_CLIENT_SECRET,
      keyring,
    });
    if (!accessToken) {
      return Response.json(
        {
          error: "GitHub connection is unavailable or requires reauthorization.",
        },
        { status: 404, headers: privateHeaders }
      );
    }

    const result = await listGitHubInstallationRepositories({
      accessToken,
      installationId: parsedInstallationId.data,
      page: query.data.page,
    });
    return Response.json(result, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof GitHubInstallationApiError) {
      const status = error.reauthorizationRequired
        ? 409
        : error.status === 403
          ? 403
          : error.status === 404
            ? 404
            : 502;
      return Response.json(
        {
          error: error.reauthorizationRequired
            ? "Reconnect GitHub to continue."
            : "GitHub repositories could not be loaded for this installation.",
        },
        { status, headers: privateHeaders }
      );
    }
    return Response.json(
      { error: "GitHub repositories could not be loaded." },
      { status: 503, headers: privateHeaders }
    );
  }
}
