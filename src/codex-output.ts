export function hideCodexCursor(chunk: string, carry: string): { text: string; carry: string } {
  const show = "\x1b[?25h";
  const input = carry + chunk;
  let cut = input.length;
  for (let n = show.length - 1; n > 0; n--) {
    if (input.endsWith(show.slice(0, n))) {
      cut -= n;
      break;
    }
  }
  return {
    text: input.slice(0, cut).replaceAll(show, "\x1b[?25l"),
    carry: input.slice(cut),
  };
}

export interface CursorAnchor { col: number; rowFromBottom: number }

export function keepComposerCursor(
  anchor: CursorAnchor,
  candidate: { col: number; row: number },
  rows: number,
): CursorAnchor {
  return candidate.row === rows - 1 - anchor.rowFromBottom
    ? { ...anchor, col: candidate.col }
    : anchor;
}
