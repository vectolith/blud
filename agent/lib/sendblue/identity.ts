import type { SessionAuthContext } from "eve/context";
import { db } from "@db";
import { normalizeAuthPhoneNumber } from "@shared/identity/phone-number";
import { accessScopeForUser } from "@shared/identity/access-scope";

/**
 * Resolve an inbound Sendblue number to the principal a turn runs as.
 *
 * Only a verified number is accepted: an unverified match would let anyone who can
 * spoof a sender field read someone else's workspace. Unknown numbers return
 * undefined and the channel answers with a sign-in instruction instead of a session.
 *
 * The principal id follows the same `better-auth:` convention the Linq channel uses,
 * so scopeFromPrincipal derives the identical workspace for a user on either channel.
 */
export async function resolveSendbluePrincipal(
  rawPhoneNumber: string
): Promise<SessionAuthContext | undefined> {
  const phoneNumber = normalizeAuthPhoneNumber(rawPhoneNumber);
  if (!phoneNumber) return undefined;

  const account = await db.query.user.findFirst({
    columns: { id: true, phoneNumberVerified: true },
    where: (table, { eq }) => eq(table.phoneNumber, phoneNumber),
  });
  if (account?.phoneNumberVerified !== true) return undefined;

  const principalId = `better-auth:${account.id}`;
  const scope = accessScopeForUser(principalId);
  return {
    attributes: {
      conversationChannel: "sendblue",
      phoneNumber,
      workspaceId: scope.workspaceId,
    },
    authenticator: "sendblue",
    principalId,
    principalType: "user",
  };
}
