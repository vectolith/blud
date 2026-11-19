import { z } from "zod";
import { getAuth } from "@db/services/auth";

const authenticatedSessionSchema = z
  .object({
    user: z
      .object({
        id: z.string().min(1),
      })
      .loose(),
  })
  .loose();

export async function getAuthSession(headers: Headers) {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers });
  const parsed = authenticatedSessionSchema.safeParse(session);
  return parsed.success ? parsed.data : null;
}
