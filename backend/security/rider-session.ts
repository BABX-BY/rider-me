import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

interface RiderTokenPayload {
  riderId: number;
  exp: number;
}

function getSessionSecret(): string {
  const secret = process.env.RIDER_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("RIDER_SESSION_SECRET ต้องมีอย่างน้อย 32 ตัวอักษร");
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function sign(content: string): string {
  return createHmac("sha256", getSessionSecret()).update(content).digest("base64url");
}

export function createRiderToken(riderId: number): string {
  const payload: RiderTokenPayload = {
    riderId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function readRiderToken(token: string): RiderTokenPayload | null {
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  const expectedSignature = Buffer.from(sign(encodedPayload));
  const actualSignature = Buffer.from(encodedSignature);
  if (expectedSignature.length !== actualSignature.length || !timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as RiderTokenPayload;
    if (!Number.isInteger(payload.riderId) || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
