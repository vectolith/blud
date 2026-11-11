import { z } from "zod";

const permissionSchema = z.enum(["read", "write", "admin"]);

const installationSchema = z.object({
  id: z.number().int().positive(),
  account: z.object({
    id: z.number().int().positive(),
    login: z.string().min(1).max(255),
    type: z.string().min(1).max(64),
  }),
  app_id: z.number().int().positive(),
  target_type: z.string().min(1).max(64),
  permissions: z.record(z.string(), permissionSchema),
  repository_selection: z.enum(["all", "selected"]),
  suspended_at: z.string().nullable().optional(),
});

const installationsResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z.array(installationSchema),
});

const repositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(255),
  full_name: z.string().min(1).max(512),
  private: z.boolean(),
  archived: z.boolean(),
  default_branch: z.string().nullable().optional(),
  permissions: z
    .object({
      admin: z.boolean().optional(),
      maintain: z.boolean().optional(),
      push: z.boolean().optional(),
      triage: z.boolean().optional(),
      pull: z.boolean().optional(),
    })
    .optional(),
});

const repositoriesResponseSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(repositorySchema),
});

export class GitHubInstallationApiError extends Error {
  readonly status: number;
  readonly reauthorizationRequired: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubInstallationApiError";
    this.status = status;
    this.reauthorizationRequired = status === 401;
  }
}

export interface GitHubInstallationPage {
  readonly totalCount: number;
  readonly page: number;
  readonly hasNextPage: boolean;
  readonly installations: {
    id: number;
    account: { id: number; login: string; type: string };
    appId: number;
    targetType: string;
    permissions: Record<string, "read" | "write" | "admin">;
    repositorySelection: "all" | "selected";
    suspendedAt?: string | null;
  }[];
}

export interface GitHubRepositoryPage {
  readonly totalCount: number;
  readonly page: number;
  readonly hasNextPage: boolean;
  readonly repositories: {
    id: number;
    name: string;
    fullName: string;
    private: boolean;
    archived: boolean;
    defaultBranch?: string | null;
    permissions?: {
      admin?: boolean;
      maintain?: boolean;
      push?: boolean;
      triage?: boolean;
      pull?: boolean;
    }[];
}

function hasNextPage(linkHeader: string | null): boolean {
  return (
    linkHeader
      ?.split(",")
      .some((link) => /;\s*rel="next"/u.test(link)) ?? false
  );
}

async function requestGitHubJson(
  url: URL,
  accessToken: string,
  fetcher: typeof fetch
): Promise<{ payload: unknown; linkHeader: string | null }> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "x-github-api-version": "2026-03-10",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GitHubInstallationApiError(
      503,
      "GitHub installation service is unavailable."
    );
  }

  if (!response.ok) {
    throw new GitHubInstallationApiError(
      response.status,
      response.status === 401
        ? "GitHub authorization must be renewed."
        : "GitHub could not return installation access."
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GitHubInstallationApiError(
      502,
      "GitHub returned an invalid installation response."
    );
  }

  return {
    payload,
    linkHeader: response.headers.get("link"),
  };
}

export async function listGitHubUserInstallations(input: {
  accessToken: string;
  page: number;
  fetcher?: typeof fetch;
}): Promise<GitHubInstallationPage> {
  const url = new URL("https://api.github.com/user/installations");
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(input.page));

  const response = await requestGitHubJson(
    url,
    input.accessToken,
    input.fetcher ?? fetch
  );
  const parsed = installationsResponseSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw new GitHubInstallationApiError(
      502,
      "GitHub returned an invalid installation list."
    );
  }

  return {
    totalCount: parsed.data.total_count,
    page: input.page,
    hasNextPage: hasNextPage(response.linkHeader),
    installations: parsed.data.installations.map((installation) => {
      const mapped: GitHubInstallationPage["installations"][number] = {
        id: installation.id,
        account: installation.account,
        appId: installation.app_id,
        targetType: installation.target_type,
        permissions: installation.permissions,
        repositorySelection: installation.repository_selection,
      };
      if (installation.suspended_at !== undefined) {
        mapped.suspendedAt = installation.suspended_at;
      }
      return mapped;
    }),
  };
}

export async function listGitHubInstallationRepositories(input: {
  accessToken: string;
  installationId: string;
  page: number;
  fetcher?: typeof fetch;
}): Promise<GitHubRepositoryPage> {
  if (!/^[1-9][0-9]{0,19}$/u.test(input.installationId)) {
    throw new GitHubInstallationApiError(
      400,
      "GitHub installation identifier is invalid."
    );
  }
  const url = new URL(
    `https://api.github.com/user/installations/${input.installationId}/repositories`
  );
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(input.page));

  const response = await requestGitHubJson(
    url,
    input.accessToken,
    input.fetcher ?? fetch
  );
  const parsed = repositoriesResponseSchema.safeParse(response.payload);
  if (!parsed.success) {
    throw new GitHubInstallationApiError(
      502,
      "GitHub returned an invalid repository list."
    );
  }

  return {
    totalCount: parsed.data.total_count,
    page: input.page,
    hasNextPage: hasNextPage(response.linkHeader),
    repositories: parsed.data.repositories.map((repository) => {
      const mapped: GitHubRepositoryPage["repositories"][number] = {
        id: repository.id,
        name: repository.name,
        fullName: repository.full_name,
        private: repository.private,
        archived: repository.archived,
      };
      if (repository.default_branch !== undefined) {
        mapped.defaultBranch = repository.default_branch;
      }
      if (repository.permissions !== undefined) {
        mapped.permissions = repository.permissions;
      }
      return mapped;
    }),
  };
}
