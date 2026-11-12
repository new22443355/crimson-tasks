const encoder = new TextEncoder();
const ITERATIONS = 100_000;
export const SESSION_AGE = 60 * 60 * 24 * 14;
export const COOKIE_NAME = "crimson_session";

export function randomToken(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derive(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: encoder.encode(salt),
  }, key, 256);
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomToken(16);
  return `pbkdf2_sha256$${ITERATIONS}$${salt}$${await derive(password, salt)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterations, salt, expected] = encoded.split("$");
  if (algorithm !== "pbkdf2_sha256" || Number(iterations) !== ITERATIONS || !salt || !expected) return false;
  const actual = await derive(password, salt);
  let difference = expected.length ^ actual.length;
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ (expected.charCodeAt(index) || 0);
  return difference === 0;
}

export function sessionToken(request: Request): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === COOKIE_NAME && /^[a-f0-9]{64}$/.test(value ?? "")) return value;
  }
  return null;
}

export function sessionCookie(request: Request, token: string, clear = false): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_AGE}${secure}`;
}
