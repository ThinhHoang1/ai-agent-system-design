import { createHmac, timingSafeEqual } from "node:crypto";

// Sign the RAW body. Re-serialising parsed JSON changes bytes and breaks signatures.
export function sign(secret: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

// Constant-time compare: a plain === leaks how many leading bytes matched.
export function verify(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(sign(secret, rawBody));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}
