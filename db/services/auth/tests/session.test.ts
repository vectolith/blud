/* oxlint-disable vitest/require-mock-type-parameters -- Session lookup needs a deliberately partial Better Auth fixture. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthSession } from "@db/services/auth/session";
import { authSessionFor } from "@tests/helpers/auth-session";

const mocks = vi.hoisted(() => ({ getAuth: vi.fn(), getSession: vi.fn() }));

vi.mock("@db/services/auth", () => ({ getAuth: mocks.getAuth }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuth.mockResolvedValue({
    api: { getSession: mocks.getSession },
  });
});

describe("auth session", () => {
  it("accepts authenticated sessions without requiring a phone number", async () => {
    const emailSession = authSessionFor({
      id: "email-user",
      email: "email@example.com",
      emailVerified: true,
    });
    const phoneSession = authSessionFor({
      id: "phone-user",
      phoneNumber: "+12025550123",
      phoneNumberVerified: true,
    });
    const unverifiedPhoneSession = authSessionFor({
      id: "unverified-phone-user",
      phoneNumber: "+12025550124",
      phoneNumberVerified: false,
    });

    mocks.getSession
      .mockResolvedValueOnce(emailSession)
      .mockResolvedValueOnce(phoneSession)
      .mockResolvedValueOnce(unverifiedPhoneSession)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user: { id: "" } })
      .mockResolvedValueOnce({ user: {} });

    const headers = new Headers();
    await expect(getAuthSession(headers)).resolves.toEqual(emailSession);
    await expect(getAuthSession(headers)).resolves.toEqual(phoneSession);
    await expect(getAuthSession(headers)).resolves.toEqual(
      unverifiedPhoneSession
    );
    await expect(getAuthSession(headers)).resolves.toBeNull();
    await expect(getAuthSession(headers)).resolves.toBeNull();
    await expect(getAuthSession(headers)).resolves.toBeNull();
  });
});
