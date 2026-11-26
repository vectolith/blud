import { deleteObject, getObject, putObject, type S3Config } from "./s3";

/**
 * The application object store. One S3-compatible bucket holds installation
 * secrets and browser-image artifacts; nothing here depends on a hosting
 * platform.
 */

export interface ObjectStoreEnvironment {
  S3_ACCESS_KEY_ID?: string | undefined;
  S3_BUCKET?: string | undefined;
  S3_ENDPOINT?: string | undefined;
  S3_FORCE_PATH_STYLE?: string | undefined;
  S3_REGION?: string | undefined;
  S3_SECRET_ACCESS_KEY?: string | undefined;
}

export interface ObjectStoreWriteOptions {
  cacheControl?: string;
  contentType?: string;
  createOnly?: boolean;
  signal?: AbortSignal | undefined;
}

export interface StoredObjectBody {
  body: Uint8Array;
  contentLength: number;
  contentType: string | undefined;
  etag: string | undefined;
}

export function objectStoreConfig(
  environment: ObjectStoreEnvironment
): S3Config | undefined {
  const endpoint = environment.S3_ENDPOINT?.trim();
  const bucket = environment.S3_BUCKET?.trim();
  const accessKeyId = environment.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = environment.S3_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return undefined;
  }
  return {
    accessKeyId,
    bucket,
    endpoint,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE !== "false",
    region: environment.S3_REGION?.trim() || "auto",
    secretAccessKey,
  };
}

export function objectStoreConfigured(environment: ObjectStoreEnvironment) {
  return objectStoreConfig(environment) !== undefined;
}

function requireConfig(environment: ObjectStoreEnvironment) {
  const config = objectStoreConfig(environment);
  if (!config) {
    throw new Error(
      "Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY."
    );
  }
  return config;
}

export async function writeObject(
  environment: ObjectStoreEnvironment,
  pathname: string,
  body: Uint8Array,
  options: ObjectStoreWriteOptions = {}
) {
  return putObject(requireConfig(environment), pathname, body, {
    cacheControl: options.cacheControl,
    contentType: options.contentType,
    ifNoneMatch: options.createOnly,
    signal: options.signal,
  });
}

export async function readObject(
  environment: ObjectStoreEnvironment,
  pathname: string
): Promise<StoredObjectBody | undefined> {
  const response = await getObject(requireConfig(environment), pathname);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      "The object store returned HTTP " +
        response.status +
        " for " +
        pathname +
        "."
    );
  }
  const body = new Uint8Array(await response.arrayBuffer());
  return {
    body,
    contentLength: body.byteLength,
    contentType: response.headers.get("content-type") ?? undefined,
    etag: response.headers.get("etag") ?? undefined,
  };
}

export async function removeObject(
  environment: ObjectStoreEnvironment,
  pathname: string
) {
  const response = await deleteObject(requireConfig(environment), pathname);
  if (!response.ok && response.status !== 404) {
    throw new Error(
      "The object store returned HTTP " +
        response.status +
        " while deleting " +
        pathname +
        "."
    );
  }
}
