import assert from "node:assert/strict";
import { hideCodexCursor, keepComposerCursor } from "../src/codex-output.ts";

const SHOW = "\x1b[?25h";
const HIDE = "\x1b[?25l";

let carry = "";
let out = "";
for (const chunk of ["abc\x1b[?", "25hdef", "\x1b[?25", "hghi"]) {
  const next = hideCodexCursor(chunk, carry);
  out += next.text;
  carry = next.carry;
}
out += carry;

assert.equal(out, `abc${HIDE}def${HIDE}ghi`);
assert.equal(out.includes(SHOW), false);

const anchor = { col: 3, rowFromBottom: 1 };
assert.deepEqual(keepComposerCursor(anchor, { col: 7, row: 28 }, 30), { col: 7, rowFromBottom: 1 });
assert.deepEqual(keepComposerCursor(anchor, { col: 42, row: 12 }, 30), anchor);
console.log("codex cursor filter: ok");
