import crypto from "crypto";

export function verifyHmacSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const cleanSig = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader.trim();

  const expectedHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const sigBuf = Buffer.from(cleanSig, "hex");
  const expBuf = Buffer.from(expectedHex, "hex");
  if (sigBuf.length !== expBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export function signPayload(payloadObj: unknown, secret: string): { rawJson: string; signature: string } {
  const rawJson = JSON.stringify(payloadObj);
  const signature = crypto.createHmac("sha256", secret).update(rawJson, "utf8").digest("hex");
  return { rawJson, signature };
}