import { db } from "@db";
import { normalizeAuthPhoneNumber } from "@shared/identity/phone-number";
import { accessScopeForUser } from "@shared/identity/access-scope";

export type SendbluePrincipal = {
  type: "user";
  id: string;
  attributes: { workspaceId: string };
};

/**
 * Resolve an inbound Sendblue number to a BLUD user.
 *
 * Only a verified number is accepted: an unverified match would let anyone who can
 * spoof a sender field read someone else's workspace. Unknown numbers return
 * undefined and the channel answers with a sign-in instruction instead of a session.
 */
export async function resolveSendbluePrincipal(
  rawPhoneNumber: string
): Promise<SendbluePrincipal | undefined> {
  const phoneNumber = normalizeAuthPhoneNumber(rawPhoneNumber);
  if (!phoneNumber) return undefined;

  const account = await db.query.user.findFirst({
    columns: { id: true, phoneNumberVerified: true },
    where: (table, { eq }) => eq(table.phoneNumber, phoneNumber),
  });
  if (!account || account.phoneNumberVerified !== true) return undefined;

  const scope = accessScopeForUser(account.id);
  return {
    type: "user",
    id: account.id,
    attributes: { workspaceId: scope.workspaceId },
  };
}
