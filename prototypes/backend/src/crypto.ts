import { z } from "zod";

const encoder = new TextEncoder();

/** Opaque IDs and possession secrets never depend on names or Discord display identities. */
export function token(prefix: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `${prefix}_${Buffer.from(bytes).toString("base64url")}`;
}

export async function hash(value: string) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", encoder.encode(value))).toString("hex");
}

export function equal(left: string, right: string) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

/** Encrypt dynamic external credentials under a separately held Worker secret. */
export async function seal(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret, "base64"),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value),
  );
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(encrypted).toString("base64")}`;
}

export async function unseal(value: string, secret: string) {
  const [iv, ciphertext] = z.tuple([z.string(), z.string()]).parse(value.split("."));
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret, "base64"),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64") },
    key,
    Buffer.from(ciphertext, "base64"),
  );
  return new TextDecoder().decode(plain);
}

/** Standard Webhooks v1 signs exact bytes, attempt time, and the stable delivery ID. */
export async function signature(
  secret: string,
  deliveryId: string,
  timestamp: string,
  body: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${deliveryId}.${timestamp}.${body}`),
  );
  return `v1,${Buffer.from(signed).toString("base64")}`;
}

/** Bound external JSON before parsing, including responses without Content-Length. */
export async function readJson<T extends z.ZodType>(
  response: Response,
  schema: T,
): Promise<z.infer<T>> {
  if (!response.body) throw new Error("empty_integration_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error("integration_response_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
