import { createHash, createHmac } from "node:crypto";

/**
 * Minimal S3-compatible object storage client (SigV4, path-style by default).
 *
 * Works with any bucket that speaks the S3 API: AWS S3, Cloudflare R2,
 * Backblaze B2, Wasabi, MinIO, Garage, or an S3 gateway in front of a
 * self-hosted store. Only what Blud needs is implemented: put, get, head,
 * and delete.
 */

export interface S3Config {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  region: string;
  secretAccessKey: string;
}

export interface PutObjectOptions {
  cacheControl?: string;
  contentType?: string;
  /** Refuse to replace an existing object when true. */
  ifNoneMatch?: boolean;
  signal?: AbortSignal | undefined;
}

const emptyPayloadHash =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(key: string | Uint8Array, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

/** Percent-encode one key segment the way SigV4 canonicalisation expects. */
export function encodeS3Segment(segment: string) {
  return encodeURIComponent(segment).replace(/['()*!]/gu, (character) =>
    "%" + character.charCodeAt(0).toString(16).toUpperCase()
  );
}

export function encodeS3Path(pathname: string) {
  return pathname.split("/").map(encodeS3Segment).join("/");
}

export function amzDate(date: Date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/gu, "");
  return { full: iso, short: iso.slice(0, 8) };
}

export function objectUrl(config: S3Config, pathname: string) {
  const base = new URL(config.endpoint);
  const prefix = base.pathname.replace(/\/+$/u, "");
  const key = encodeS3Path(pathname.replace(/^\/+/u, ""));
  if (!config.forcePathStyle) {
    return new URL(base.origin + prefix + "/" + key);
  }
  return new URL(
    base.origin + prefix + "/" + encodeS3Segment(config.bucket) + "/" + key
  );
}

export function signedHeaders(
  config: S3Config,
  input: {
    contentType?: string;
    date: Date;
    headers?: Record<string, string>;
    method: string;
    pathname: string;
    payloadHash: string;
  }
) {
  const url = objectUrl(config, input.pathname);
  const { full, short } = amzDate(input.date);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": full,
    ...input.headers,
  };
  if (input.contentType) headers["content-type"] = input.contentType;

  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const lookup = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value.trim()])
  );
  const canonicalHeaders = names.map((name) => name + ":" + lookup[name] + "\n").join("");
  const canonicalRequest = [
    input.method,
    url.pathname,
    "",
    canonicalHeaders,
    names.join(";"),
    input.payloadHash,
  ].join("\n");

  const scope = short + "/" + config.region + "/s3/aws4_request";
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    full,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac("AWS4" + config.secretAccessKey, short), config.region), "s3"),
    "aws4_request"
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");

  const requestHeaders: Record<string, string> = { ...headers };
  delete requestHeaders.host;
  requestHeaders.authorization =
    "AWS4-HMAC-SHA256 Credential=" +
    config.accessKeyId +
    "/" +
    scope +
    ", SignedHeaders=" +
    names.join(";") +
    ", Signature=" +
    signature;
  return { headers: requestHeaders, url };
}

export async function putObject(
  config: S3Config,
  pathname: string,
  body: Uint8Array,
  options: PutObjectOptions = {}
) {
  const extra: Record<string, string> = {};
  if (options.cacheControl) extra["cache-control"] = options.cacheControl;
  if (options.ifNoneMatch) extra["if-none-match"] = "*";
  const { headers, url } = signedHeaders(config, {
    contentType: options.contentType ?? "application/octet-stream",
    date: new Date(),
    headers: extra,
    method: "PUT",
    pathname,
    payloadHash: sha256Hex(body),
  });
  return fetch(url, {
    body,
    headers,
    method: "PUT",
    redirect: "error",
    signal: options.signal,
  });
}

export async function getObject(config: S3Config, pathname: string) {
  const { headers, url } = signedHeaders(config, {
    date: new Date(),
    method: "GET",
    pathname,
    payloadHash: emptyPayloadHash,
  });
  return fetch(url, { headers, method: "GET", redirect: "error" });
}

export async function headObject(config: S3Config, pathname: string) {
  const { headers, url } = signedHeaders(config, {
    date: new Date(),
    method: "HEAD",
    pathname,
    payloadHash: emptyPayloadHash,
  });
  return fetch(url, { headers, method: "HEAD", redirect: "error" });
}

export async function deleteObject(config: S3Config, pathname: string) {
  const { headers, url } = signedHeaders(config, {
    date: new Date(),
    method: "DELETE",
    pathname,
    payloadHash: emptyPayloadHash,
  });
  return fetch(url, { headers, method: "DELETE", redirect: "error" });
}
