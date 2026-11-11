import { describe, expect, it, vi } from "vitest";
import {
  buildGitHubAuthorizationUrl,
  exchangeGitHubAuthorizationCode,
  fetchGitHubAccount,
  GitHubOAuthError,
  refreshGitHubUserAccessToken,
} from "./oauth";

describe("GitHub App OAuth client", () => {
  it("builds a PKCE authorization request without requesting broad repository scopes", () => {
    const url = buildGitHubAuthorizationUrl({
      clientId: "github-client-id",
      redirectUri: "https://blud.example/api/integrations/github/callback",
      state: "unguessable-state",
      codeChallenge: "a".repeat(43),
    });

    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize"
    );
    expect(url.searchParams.get("client_id")).toBe("github-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://blud.example/api/integrations/github/callback"
    );
    expect(url.searchParams.get("state")).toBe("unguessable-state");
    expect(url.searchParams.get("code_challenge")).toBe("a".repeat(43));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("offline_access");
    expect(url.searchParams.get("allow_signup")).toBe("false");
  });

  it("exchanges an authorization code using the exact redirect URI and PKCE verifier", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "ghu_access",
        refresh_token: "ghr_refresh",
        expires_in: 28800,
        refresh_token_expires_in: 15897600,
        scope: "",
        token_type: "bearer",
      })
    );

    const token = await exchangeGitHubAuthorizationCode({
      clientId: "client",
      clientSecret: "server-secret",
      code: "one-time-code",
      redirectUri: "https://blud.example/api/integrations/github/callback",
      codeVerifier: "original-verifier",
      fetcher,
    });

    expect(token.access_token).toBe("ghu_access");
    expect(token.refresh_token).toBe("ghr_refresh");
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("code")).toBe("one-time-code");
    expect(body.get("code_verifier")).toBe("original-verifier");
    expect(body.get("redirect_uri")).toBe(
      "https://blud.example/api/integrations/github/callback"
    );
    expect(body.get("client_secret")).toBe("server-secret");
  });

  it("rotates an expiring GitHub App user token with its refresh token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "ghu_rotated",
        refresh_token: "ghr_rotated",
        expires_in: 28800,
        refresh_token_expires_in: 15897600,
        scope: "",
        token_type: "bearer",
      })
    );

    const token = await refreshGitHubUserAccessToken({
      clientId: "client",
      clientSecret: "server-secret",
      refreshToken: "ghr_old",
      fetcher,
    });

    expect(token.access_token).toBe("ghu_rotated");
    expect(token.refresh_token).toBe("ghr_rotated");
    const [, init] = fetcher.mock.calls[0]!;
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("ghr_old");
  });

  it("rejects malformed or unsuccessful token responses without exposing provider bodies", async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ access_token: "partial-secret" })
    );
    await expect(
      refreshGitHubUserAccessToken({
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "refresh",
        fetcher: malformed,
      })
    ).rejects.toThrow(GitHubOAuthError);

    const rejected = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("access_token=provider-secret", { status: 401 })
    );
    await expect(
      exchangeGitHubAuthorizationCode({
        clientId: "client",
        clientSecret: "secret",
        code: "code",
        redirectUri: "https://blud.example/callback",
        codeVerifier: "verifier",
        fetcher: rejected,
      })
    ).rejects.toThrow("GitHub rejected the token request.");
  });

  it("validates the GitHub account using the returned access token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ id: 1234, login: "octocat", name: "The Octocat" })
    );

    await expect(fetchGitHubAccount("ghu_access", fetcher)).resolves.toEqual({
      id: 1234,
      login: "octocat",
      name: "The Octocat",
    });
    const [, init] = fetcher.mock.calls[0]!;
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer ghu_access"
    );
    expect(init?.redirect).toBe("error");
  });

  it("rejects an unverified or malformed account response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ id: "not-an-id", login: "octocat" })
    );
    await expect(fetchGitHubAccount("ghu_access", fetcher)).rejects.toThrow(
      "GitHub returned an invalid account response."
    );
  });
});
