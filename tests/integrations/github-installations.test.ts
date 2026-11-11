import { describe, expect, it, vi } from "vitest";
import {
  GitHubInstallationApiError,
  listGitHubInstallationRepositories,
  listGitHubUserInstallations,
} from "../../integrations/github/installations";

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href;
  if (typeof input === "string") return input;
  return input.url;
}

describe("GitHub App installation discovery", () => {
  it("lists only installations visible to the authorized user", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          total_count: 1,
          installations: [
            {
              id: 987,
              account: { id: 123, login: "octo-org", type: "Organization" },
              app_id: 456,
              target_type: "Organization",
              permissions: { contents: "read", metadata: "read" },
              repository_selection: "selected",
              suspended_at: null,
            },
          ],
        },
        {
          headers: {
            link:
              '<https://api.github.com/user/installations?per_page=100&page=2>; rel="next"',
          },
        }
      )
    );

    await expect(
      listGitHubUserInstallations({
        accessToken: "ghu_user-token",
        page: 1,
        fetcher,
      })
    ).resolves.toEqual({
      totalCount: 1,
      page: 1,
      hasNextPage: true,
      installations: [
        {
          id: 987,
          account: { id: 123, login: "octo-org", type: "Organization" },
          appId: 456,
          targetType: "Organization",
          permissions: { contents: "read", metadata: "read" },
          repositorySelection: "selected",
          suspendedAt: null,
        },
      ],
    });

    const installationRequest = fetcher.mock.calls[0];
    if (!installationRequest) {
      throw new Error("Expected a GitHub installation request.");
    }
    const [url, init] = installationRequest;
    expect(requestUrl(url)).toBe(
      "https://api.github.com/user/installations?per_page=100&page=1"
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer ghu_user-token"
    );
  });

  it("lists repositories with effective user permissions", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        total_count: 1,
        repositories: [
          {
            id: 321,
            name: "blud",
            full_name: "vectolith/blud",
            private: true,
            archived: false,
            default_branch: "main",
            permissions: {
              admin: false,
              maintain: false,
              push: true,
              triage: true,
              pull: true,
            },
          },
        ],
      })
    );

    await expect(
      listGitHubInstallationRepositories({
        accessToken: "ghu_user-token",
        installationId: "987",
        page: 3,
        fetcher,
      })
    ).resolves.toEqual({
      totalCount: 1,
      page: 3,
      hasNextPage: false,
      repositories: [
        {
          id: 321,
          name: "blud",
          fullName: "vectolith/blud",
          private: true,
          archived: false,
          defaultBranch: "main",
          permissions: {
            admin: false,
            maintain: false,
            push: true,
            triage: true,
            pull: true,
          },
        },
      ],
    });

    const repositoryRequest = fetcher.mock.calls[0];
    if (!repositoryRequest) {
      throw new Error("Expected a GitHub repository request.");
    }
    const [url] = repositoryRequest;
    const expectedUrl = new URL(
      "/user/installations/987/repositories?per_page=100&page=3",
      "https://api.github.com"
    );
    expect(requestUrl(url)).toBe(expectedUrl.href);
  });

  it("requires reauthorization when GitHub rejects the user token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("private provider detail", { status: 401 })
    );

    await expect(
      listGitHubUserInstallations({
        accessToken: "revoked-token",
        page: 1,
        fetcher,
      })
    ).rejects.toMatchObject({
      status: 401,
      reauthorizationRequired: true,
    });
  });

  it("rejects malformed provider installation payloads", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ total_count: 1, installations: [{ id: "not-a-number" }] })
    );

    await expect(
      listGitHubUserInstallations({
        accessToken: "ghu_user-token",
        page: 1,
        fetcher,
      })
    ).rejects.toBeInstanceOf(GitHubInstallationApiError);
  });
});
