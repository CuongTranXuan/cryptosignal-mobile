/** Legacy web workaround: reasoning was stored in `title` after this separator. */
export const SESSION_REASONING_TITLE_SEP = "\u001e";

export function titleHasLegacyReasoningEncoding(title: string): boolean {
  return title.includes(SESSION_REASONING_TITLE_SEP);
}

export function stripLegacyReasoningFromTitle(encoded: string): string {
  const idx = encoded.indexOf(SESSION_REASONING_TITLE_SEP);
  if (idx < 0) return encoded;
  return encoded.slice(0, idx);
}

export function decodeLegacySessionTitle(encoded: string): {
  title: string;
  reasoning_effort: string | null;
} {
  const idx = encoded.indexOf(SESSION_REASONING_TITLE_SEP);
  if (idx < 0) {
    return { title: encoded, reasoning_effort: null };
  }
  const title = encoded.slice(0, idx);
  const effort = encoded.slice(idx + SESSION_REASONING_TITLE_SEP.length).trim();
  return { title, reasoning_effort: effort || null };
}
