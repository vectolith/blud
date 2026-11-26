import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  MemoryDocumentConflictError,
  type MemoryDocument,
  type MemoryDocumentBackend,
  type MemoryDocumentReadInput,
  type MemoryDocumentWriteInput,
} from "eve/memory/file";
import { encodeS3Path } from "./s3";
import { readObject, writeObject } from "./object-store";

/**
 * Stores each eve memory document as one JSON object in the configured
 * S3-compatible bucket, with optimistic concurrency on the document version.
 */

const documentSchema = z.object({
  content: z.string(),
  version: z.string().min(1),
});

export function s3MemoryBackend(
  environment: Parameters<typeof readObject>[0],
  prefix = "blud/memory"
): MemoryDocumentBackend {
  const pathname = (key: string) =>
    prefix + "/" + encodeS3Path(key) + ".memory.json";

  return {
    read: async (input: MemoryDocumentReadInput) => {
      const stored = await readObject(environment, pathname(input.key));
      if (!stored) return null;
      const parsed = documentSchema.safeParse(
        JSON.parse(Buffer.from(stored.body).toString("utf8"))
      );
      return parsed.success ? parsed.data : null;
    },
    write: async (input: MemoryDocumentWriteInput): Promise<MemoryDocument> => {
      const target = pathname(input.key);
      const current = await readObject(environment, target);
      const currentVersion = current ? parseVersion(current.body) : null;
      if (input.expectedVersion === null) {
        if (currentVersion !== null) {
          throw new MemoryDocumentConflictError(input.key);
        }
      } else if (currentVersion !== input.expectedVersion) {
        throw new MemoryDocumentConflictError(input.key);
      }

      const written = documentSchema.parse({
        content: input.content,
        version: randomUUID(),
      });
      const response = await writeObject(
        environment,
        target,
        Buffer.from(JSON.stringify(written), "utf8"),
        { contentType: "application/json" }
      );
      if (!response.ok) {
        throw new Error(
          "The object store rejected the memory write (HTTP " +
            response.status +
            ")."
        );
      }
      return { content: written.content, version: written.version };
    },
  };
}

function parseVersion(body: Uint8Array) {
  const parsed = documentSchema.safeParse(
    JSON.parse(Buffer.from(body).toString("utf8"))
  );
  return parsed.success ? parsed.data.version : null;
}
