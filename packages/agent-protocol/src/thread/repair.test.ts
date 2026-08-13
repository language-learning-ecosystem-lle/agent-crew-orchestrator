import { describe, expect, it } from "vitest";

import { synthesiseMeta } from "./repair.js";

const file = (name: string, content: string) => ({ fileName: name, content });

const message = (from: string, body: string): string =>
  `---\nfrom: ${from}\ndate: 2026-08-13T17:20:00Z\nexpects: answer\nwaiting-on: dev-core\n---\n\n${body}\n`;

describe("synthesiseMeta — the head of a thread, out of its own messages", () => {
  it("title from the first thing SAID, participants in the order they spoke, status open", () => {
    const meta = synthesiseMeta("066-test-gaps", [
      file("2026-08-13T17-20-00Z-curator.md", message("curator", "**Test gaps:** six statements.")),
      file("2026-08-13T17-28-50Z-dev-core.md", message("dev-core", "Taken.")),
      file("2026-08-13T17-40-00Z-curator.md", message("curator", "Again.")),
    ]);

    // The markdown emphasis is stripped: a title is a line a human reads in an index.
    expect(meta.title).toBe("Test gaps: six statements.");
    expect(meta.participants).toEqual(["curator", "dev-core"]);
    // Never 'closed' — an acceptance is not something a synthesiser is allowed to guess.
    expect(meta.status).toBe("open");
    expect(meta.guessedAuthors).toEqual([]);
  });

  it("a title given by hand wins, and an empty thread still gets a title (its id)", () => {
    expect(
      synthesiseMeta(
        "066-x",
        [file("2026-08-13T17-20-00Z-curator.md", message("curator", "Body."))],
        {
          title: "Test gaps",
        },
      ).title,
    ).toBe("Test gaps");
    expect(synthesiseMeta("066-x", []).title).toBe("066-x");
  });

  it("a file whose header cannot be read still names its author — FROM THE FILE NAME, and says so", () => {
    // The whole point of a repair is a thread that does not parse: a synthesiser standing on
    // the strict reader would refuse exactly the files it exists for.
    const meta = synthesiseMeta("066-x", [
      file("2026-08-13T17-20-00Z-curator.md", "no front matter at all\n"),
      file("2026-08-13T17-28-50Z-dev-core.md", message("dev-core", "Taken.")),
    ]);

    expect(meta.participants).toEqual(["curator", "dev-core"]);
    // A guess is carried as a guess: the caller prints it, so nobody reads it as a reading.
    expect(meta.guessedAuthors).toEqual(["2026-08-13T17-20-00Z-curator.md"]);
    // ...and the title is the first line of that file — a body with no header is still a body.
    expect(meta.title).toBe("no front matter at all");
  });

  it("a broken FIELD does not cost the author: only 'from:' is read here", () => {
    // The second failure of 2026-08-13 — a `date:` in the shape of the file name. The strict
    // reader refuses the thread on it; this one takes the one field a head needs and moves on.
    const meta = synthesiseMeta("066-x", [
      file(
        "2026-08-13T17-28-50Z-curator.md",
        "---\nfrom: curator\ndate: 2026-08-13T17-28-50Z\nexpects: answer\n---\n\nThe body.\n",
      ),
    ]);

    expect(meta.participants).toEqual(["curator"]);
    expect(meta.guessedAuthors).toEqual([]);
  });
});
