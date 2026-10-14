import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

/** The declarations in the first rule with this exact selector, `property: value` each. */
function declarationsOf(selector: string): string[] {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is missing`).toBeGreaterThan(-1);
  const body = css.slice(at + selector.length + 2, css.indexOf("}", at));
  return body
    .split(";")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function propertiesOf(selector: string): string[] {
  return declarationsOf(selector).map((line) => (line.split(":")[0] ?? "").trim());
}

// Untick Enable Time Configuration and every time control stays where it was, disabled. That
// only holds while the off state is drawn with properties that cannot resize a box: one `display: none` or one padding
// here and the page jumps under the cursor that ticked it again, which is what this replaced.
const NON_LAYOUT = ["opacity", "color", "background", "border-color", "cursor", "filter"];

describe("the off state of a time control", () => {
  for (const selector of [
    ".night-off",
    ".night-chip-set:disabled",
    ".night-chip-set:disabled > span",
    ".night-pin.is-off",
  ]) {
    it(`${selector} changes nothing that has a size`, () => {
      for (const property of propertiesOf(selector)) {
        expect(NON_LAYOUT, `${selector} sets ${property}`).toContain(property);
      }
    });
  }
});

// A chip is one pill made of two buttons, and whether somebody is on is the whole pill's answer.
// Lighting only the name half is what this replaced, and it read as a lit chip with a grey stub
// stuck on the end.
describe("a chip that is on", () => {
  it("lights both halves the same", () => {
    expect(declarationsOf(".night-chip-set.is-on")).toEqual(declarationsOf(".night-person.is-on"));
  });
});
