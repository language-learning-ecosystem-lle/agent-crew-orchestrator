/**
 * The templating door. The tests are about the two ways a text a project owns can
 * fail quietly: a placeholder nobody provides, and a placeholder nobody meant.
 */
import { describe, expect, it } from "vitest";

import { renderTemplate, TemplateError, templateIssues, templateVariables } from "./template.js";

describe("templates — the project's words, validated at the door", () => {
  it("finds the placeholders in order, without repeats", () => {
    expect(templateVariables("{thread} · {role} again {thread}")).toEqual(["thread", "role"]);
  });

  it("treats braces that are not a placeholder as literal text", () => {
    // A smiley, a JSON snippet, an emoji: prose has braces in it, and a validator
    // that fails on them would be a validator projects learn to route around.
    expect(templateVariables("{ } {1} {-} {}")).toEqual([]);
    expect(renderTemplate("{ } literal {1}", {})).toBe("{ } literal {1}");
  });

  it("REFUSES a placeholder outside the vocabulary of the slot, naming what is on offer", () => {
    const issues = templateIssues("your turn: {thraed}", ["thread", "role"]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("'{thraed}'");
    expect(issues[0]).toContain("'{thread}'");
  });

  it("reports EVERY unknown placeholder in one complaint, not the first one", () => {
    // A config is edited by a human, and "fix this, then learn about the next one"
    // is the loop the role registry already refuses to make anyone walk.
    const issues = templateIssues("{a} {b}", ["thread"]);

    expect(issues[0]).toContain("'{a}', '{b}'");
  });

  it("substitutes what it was given", () => {
    expect(renderTemplate("⏳ {role}: {thread}", { role: "john", thread: "016-x" })).toBe(
      "⏳ john: 016-x",
    );
  });

  it("throws instead of rendering a hole when the caller supplied nothing for a slot", () => {
    // This can only fire when a slot's vocabulary and its renderer have drifted —
    // our defect, and it must not be delivered as a message with a gap in it.
    expect(() => renderTemplate("{thread}", { role: "john" })).toThrow(TemplateError);
  });
});
