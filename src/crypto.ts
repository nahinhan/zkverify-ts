import crypto from "crypto";
export function verifyHmacSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string, timestamp?: string): boolean {
  if (!signatureHeader || !secret) return false;
  const cleanSig = signatureHeader.replace(/^sha256=/i, "").trim().toLowerCase();
  const keys: (string | Buffer)[] = [secret];
  if (/^[0-9a-fA-F]{64}$/.test(secret)) keys.push(Buffer.from(secret, "hex"));
  const payloads: Buffer[] = [rawBody];
  if (timestamp) payloads.push(Buffer.from(`${timestamp}.${rawBody.toString("utf8")}`, "utf8"));
  for (const k of keys) { for (const p of payloads) { if (cleanSig === crypto.createHmac("sha256", k).update(p).digest("hex").toLowerCase()) return true; } }
  return false;
}
export function signPayload(payloadObj: unknown, secret: string): { rawJson: string; signature: string } {
  const rawJson = JSON.stringify(payloadObj);
  const signature = crypto.createHmac("sha256", secret).update(rawJson, "utf8").digest("hex");
  return { rawJson, signature };
}