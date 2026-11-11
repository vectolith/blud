import { z } from "zod";

const githubTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().regex(/^bearer$/iu),
  scope: z.string().default(""),
  expires_in: z.coerce.number().int().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.coerce.number().int().positive().optional(),
});

const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(39),
  name: z.string().max(255).nullable().optional(),
});

export type GitHubUserAccessToken = z.infer<typeof githubTokenResponseSchema>;
export type GitHubAccount = z.infer<typeof githubUserSchema>;

export class GitHubOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubOAuthError";
  }
}

export function buildGitHubAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): URL {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("scope", "offline_access");
  url.searchParams.set("allow_signup", "false");
  return url;
}

export async function exchangeGitHubAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetcher?: typeof fetch;
}): Promise<GitHubUserAccessToken> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });

  return requestGitHubToken(body, input.fetcher ?? fetch);
}

export async function refreshGitHubUserAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetcher?: typeof fetch;
}): Promise<GitHubUserAccessToken> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });

  return requestGitHubToken(body, input.fetcher ?? fetch);
}

async function requestGitHubToken(
  body: URLSearchParams,
  fetcher: typeof fetch
): Promise<GitHubUserAccessToken> {
  let response: Response;
  try {
    response = await fetcher("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new GitHubOAuthError("GitHub token service is unavailable.");
  }

  if (!response.ok) {
    throw new GitHubOAuthError("GitHub rejected the token request.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GitHubOAuthError("GitHub returned an invalid token response.");
  }

  const parsed = githubTokenResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GitHubOAuthError("GitHub returned an invalid token response.");
  }
  return parsed.data;
}

export async function fetchGitHubAccount(
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<GitHubAccount> {
  let response: Response;
  try {
    response = await fetcher("https://api.github.com/user", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "x-github-api-version": "2026-03-10",
      },
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new GitHubOAuthError("GitHub identity service is unavailable.");
  }

  if (!response.ok) {
    throw new GitHubOAuthError("GitHub could not verify the authorized account.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GitHubOAuthError("GitHub returned an invalid account response.");
  }

  const parsed = githubUserSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GitHubOAuthError("GitHub returned an invalid account response.");
  }
  return parsed.data;
}
