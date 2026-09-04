// IME anchor heuristic for xterm.js.
// Vendored from https://github.com/msdshsk/xterm-ime-anchor (src/imeHeuristic.ts).
//
// Problem: Ink-based TUIs (Claude Code, inkchat, …) don't cursor-park at the
// input field after rendering, so the terminal's hardware cursor — and
// therefore xterm.js's IME anchor — ends up at the wrong place.
//
// Observation: every Ink <TextInput> we've looked at draws its caret
// indicator as a single inverse-video space (SGR 7 + ' ' + SGR 27) on the
// input row.  Regardless of where the hardware cursor is, that inverse cell
// reliably marks the visual input position.

import type { Terminal } from "@xterm/xterm";

export type ImeAnchor = {
  source: "heuristic" | "hardware";
  col: number;
  row: number;
};

export type AttachOptions = {
  onAnchor?: (a: ImeAnchor) => void;
  requireIsolatedCell?: boolean;
};

type Detached = { detach(): void };

export function attachImeHeuristic(
  terminal: Terminal,
  options: AttachOptions = {}
): Detached {
  const { onAnchor, requireIsolatedCell = true } = options;

  const root = terminal.element;
  if (!root) return { detach() {} };

  const textarea = root.querySelector(
    ".xterm-helper-textarea"
  ) as HTMLTextAreaElement | null;
  const screen = root.querySelector(".xterm-screen") as HTMLElement | null;
  const compositionView = root.querySelector(
    ".composition-view"
  ) as HTMLElement | null;

  if (!textarea || !screen || !compositionView) {
    return { detach() {} };
  }

  let composing = false;
  let pinned: { left: string; top: string } | null = null;
  let renderDisposable: { dispose(): void } | null = null;

  const reapply = (el: HTMLElement) => {
    if (!composing || !pinned) return;
    if (el.style.left !== pinned.left || el.style.top !== pinned.top) {
      el.style.setProperty("left", pinned.left, "important");
      el.style.setProperty("top", pinned.top, "important");
    }
  };
  const moTa = new MutationObserver(() => reapply(textarea));
  const moCv = new MutationObserver(() => reapply(compositionView));

  function computeCellSize(): { w: number; h: number } {
    const rect = screen!.getBoundingClientRect();
    return {
      w: rect.width / Math.max(terminal.cols, 1),
      h: rect.height / Math.max(terminal.rows, 1),
    };
  }

  function findInverseCell(): { col: number; row: number } | null {
    const buf = terminal.buffer.active;
    const rows = terminal.rows;
    const startY = buf.viewportY;

    for (let y = startY + rows - 1; y >= startY; y--) {
      const line = buf.getLine(y);
      if (!line) continue;
      for (let x = line.length - 1; x >= 0; x--) {
        const cell = line.getCell(x);
        if (!cell) continue;
        if (!cell.isInverse()) continue;

        if (requireIsolatedCell) {
          const left = x > 0 ? line.getCell(x - 1) : null;
          const right = x + 1 < line.length ? line.getCell(x + 1) : null;
          const leftInv = !!left && !!left.isInverse();
          const rightInv = !!right && !!right.isInverse();
          if (leftInv && rightInv) continue;
        }

        return { col: x, row: y - startY };
      }
    }
    return null;
  }

  function recomputeAndPin() {
    if (!composing) return;

    const hit = findInverseCell();
    if (!hit) {
      return;
    }

    const { w, h } = computeCellSize();
    const left = `${Math.round(hit.col * w)}px`;
    const top = `${Math.round(hit.row * h)}px`;

    if (pinned && pinned.left === left && pinned.top === top) return;

    pinned = { left, top };
    textarea!.style.setProperty("left", left, "important");
    textarea!.style.setProperty("top", top, "important");
    compositionView!.style.setProperty("left", left, "important");
    compositionView!.style.setProperty("top", top, "important");

    onAnchor?.({ source: "heuristic", col: hit.col, row: hit.row });
  }

  function onCompositionStart() {
    composing = true;

    const hit = findInverseCell();
    if (!hit) {
      pinned = null;
      onAnchor?.({
        source: "hardware",
        col: terminal.buffer.active.cursorX,
        row: terminal.buffer.active.cursorY,
      });
    } else {
      const { w, h } = computeCellSize();
      const left = `${Math.round(hit.col * w)}px`;
      const top = `${Math.round(hit.row * h)}px`;
      pinned = { left, top };
      textarea!.style.setProperty("left", left, "important");
      textarea!.style.setProperty("top", top, "important");
      compositionView!.style.setProperty("left", left, "important");
      compositionView!.style.setProperty("top", top, "important");
      onAnchor?.({ source: "heuristic", col: hit.col, row: hit.row });
    }

    renderDisposable = terminal.onRender(() => recomputeAndPin());
  }

  function onCompositionEnd() {
    composing = false;
    pinned = null;
    renderDisposable?.dispose();
    renderDisposable = null;
  }

  textarea.addEventListener("compositionstart", onCompositionStart);
  textarea.addEventListener("compositionend", onCompositionEnd);
  moTa.observe(textarea, { attributes: true, attributeFilter: ["style"] });
  moCv.observe(compositionView, {
    attributes: true,
    attributeFilter: ["style"],
  });

  return {
    detach() {
      composing = false;
      pinned = null;
      renderDisposable?.dispose();
      renderDisposable = null;
      textarea.removeEventListener("compositionstart", onCompositionStart);
      textarea.removeEventListener("compositionend", onCompositionEnd);
      moTa.disconnect();
      moCv.disconnect();
    },
  };
}
