import type { BrowserContext } from "playwright";

// Reads the expiry of a Supabase SSR session cookie inside the process. Prints nothing of the token itself.
// An expired session would make the app refresh (and rotate) the token, which mutates server state.
export const sessionMinutesLeft = async (ctx: BrowserContext, cookiePattern: string): Promise<number> => {
  const re = new RegExp(cookiePattern);
  const parts = (await ctx.cookies()).filter((c) => re.test(c.name));
  if (parts.length === 0) throw new Error("no session cookie matching the plan's session.cookiePattern");
  const order = (n: string) => Number(n.match(/\.(\d+)$/)?.[1] ?? 0);
  let value = parts.sort((a, b) => order(a.name) - order(b.name)).map((c) => c.value).join("");
  value = decodeURIComponent(value);
  if (value.startsWith("base64-")) value = Buffer.from(value.slice(7), "base64url").toString("utf8");
  let expiresAt: unknown;
  try {
    expiresAt = (JSON.parse(value) as { expires_at?: unknown }).expires_at;
  } catch {
    throw new Error("session cookie has an unknown format");
  }
  if (typeof expiresAt !== "number") throw new Error("session cookie has no expires_at");
  return (expiresAt * 1000 - Date.now()) / 60_000;
};
