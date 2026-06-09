/**
 * Tiny UUID v4 generator. The domain types require uuid-shaped ids (zod .uuid()),
 * and crypto.randomUUID is available in Node 20+ and modern browsers — but we keep a
 * fallback so the mock never throws in any runtime.
 */
export function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback: RFC4122-shaped v4 (non-cryptographic; mock only).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
