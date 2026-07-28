import { describe, expect, it } from "vitest";

import {
  type Message,
  MessageFormatError,
  parseMessageFile,
  parseTaskDeclaration,
  renderMessageFile,
} from "./message.js";
import {
  checkTasks,
  checkThreadTasks,
  collectTaskEvents,
  foldTasks,
  renderTasksBoard,
  type TaskThreadInput,
} from "./tasks.js";
import { renderThread } from "./thread.js";

const message = (from: string, date: string, tasks: string[]): Message => ({
  fields: {
    from,
    date,
    expects: "answer",
    ...(tasks.length === 0 ? {} : { tasks: tasks.map(parseTaskDeclaration) }),
  },
  text: "body",
});

const input = (id: string, entries: readonly [string, string, string[]][]): TaskThreadInput => ({
  id,
  entries: entries.map(([from, date, tasks]) => ({
    fileName: `${date.replaceAll(":", "-")}-${from}.md`,
    message: message(from, date, tasks),
  })),
});

describe("the grammar of a declaration", () => {
  it("reads id, status and tail", () => {
    expect(parseTaskDeclaration("021.1 open · Разметка задач, валидация")).toEqual({
      id: "021.1",
      status: "open",
      tail: "Разметка задач, валидация",
    });
  });

  it("lets in-progress stand without a tail", () => {
    expect(parseTaskDeclaration("021.1 in-progress")).toEqual({
      id: "021.1",
      status: "in-progress",
    });
  });

  it("refuses an opened task without a title and a close without a fact", () => {
    expect(() => parseTaskDeclaration("021.1 open")).toThrow(/needs a title/);
    expect(() => parseTaskDeclaration("021.1 done")).toThrow(/needs the FACT/);
    expect(() => parseTaskDeclaration("021.1 dropped")).toThrow(/needs the FACT/);
  });

  it("refuses a running id, an unknown status and a broken shape", () => {
    expect(() => parseTaskDeclaration("T-37 open · x")).toThrow(/the id is 'NNN.k'/);
    expect(() => parseTaskDeclaration("021.1 started · x")).toThrow(/allowed statuses/);
    expect(() => parseTaskDeclaration("021.1")).toThrow(/the form is/);
  });

  it("survives a round trip through the message file", () => {
    const raw = renderMessageFile(
      message("curator", "2026-07-28T10:00:00Z", ["021.1 open · Разметка", "021.2 open · Борд"]),
    );
    expect(parseMessageFile(raw).fields.tasks).toHaveLength(2);
  });
});

describe("repeatable keys", () => {
  it("takes several task lines and refuses a duplicate of any other key", () => {
    const many =
      "---\nfrom: john\ndate: 2026-07-28T10:00:00Z\nexpects: ack\ntask: 021.1 in-progress\ntask: 021.2 in-progress\n---\n\nbody\n";
    expect(parseMessageFile(many).fields.tasks).toHaveLength(2);
    const twice =
      "---\nfrom: john\nfrom: curator\ndate: 2026-07-28T10:00:00Z\nexpects: ack\n---\n\nbody\n";
    expect(() => parseMessageFile(twice)).toThrow(MessageFormatError);
  });
});

describe("the state folded from the feed", () => {
  const feed = [
    input("021-native-tasks", [
      ["curator", "2026-07-28T10:00:00Z", ["021.1 open · Разметка задач"]],
      ["dev-core", "2026-07-28T11:00:00Z", ["021.1 in-progress"]],
    ]),
    input("022-other", [["dev-core", "2026-07-28T12:00:00Z", ["021.1 done · PR #64"]]]),
  ];

  it("keeps the title from the open and the fact from the close", () => {
    const [state] = foldTasks(collectTaskEvents(feed));
    expect(state).toMatchObject({
      id: "021.1",
      title: "Разметка задач",
      status: "done",
      note: "PR #64",
      owner: "dev-core",
    });
  });

  it("puts the thread of the CURRENT status in 'at', the owning one in 'opened' (П2)", () => {
    const [state] = foldTasks(collectTaskEvents(feed));
    expect(state?.at.thread).toBe("022-other");
    expect(state?.opened.thread).toBe("021-native-tasks");
  });
});

describe("what is refused", () => {
  const open = new Map<string, "open" | "closed">([
    ["021-native-tasks", "open"],
    ["022-other", "open"],
  ]);

  it("a task moved but never opened", () => {
    const events = collectTaskEvents([
      input("022-other", [["dev-core", "2026-07-28T10:00:00Z", ["021.9 done · PR #1"]]]),
    ]);
    expect(checkTasks(events, open)[0]?.message).toMatch(/never opened/);
  });

  it("an id opened twice", () => {
    const events = collectTaskEvents([
      input("021-native-tasks", [
        ["curator", "2026-07-28T10:00:00Z", ["021.1 open · A"]],
        ["curator", "2026-07-28T11:00:00Z", ["021.1 open · B"]],
      ]),
    ]);
    expect(checkTasks(events, open)[0]?.message).toMatch(/already opened/);
  });

  it("a movement after a drop — but NOT done → in-progress", () => {
    const dropped = collectTaskEvents([
      input("021-native-tasks", [
        ["curator", "2026-07-28T10:00:00Z", ["021.1 open · A"]],
        ["curator", "2026-07-28T11:00:00Z", ["021.1 dropped · снято"]],
        ["dev-core", "2026-07-28T12:00:00Z", ["021.1 in-progress"]],
      ]),
    ]);
    expect(checkTasks(dropped, open)[0]?.message).toMatch(/dropping is terminal/);

    const reopened = collectTaskEvents([
      input("021-native-tasks", [
        ["curator", "2026-07-28T10:00:00Z", ["021.1 open · A"]],
        ["dev-core", "2026-07-28T11:00:00Z", ["021.1 done · PR #1"]],
        ["dev-core", "2026-07-28T12:00:00Z", ["021.1 in-progress"]],
      ]),
    ]);
    expect(checkTasks(reopened, open)).toEqual([]);
  });

  it("a non-terminal task in a CLOSED thread — for open as well as in-progress (П5)", () => {
    const closed = new Map<string, "open" | "closed">([["021-native-tasks", "closed"]]);
    const events = collectTaskEvents([
      input("021-native-tasks", [
        ["curator", "2026-07-28T10:00:00Z", ["021.1 open · A", "021.2 open · B"]],
        ["dev-core", "2026-07-28T11:00:00Z", ["021.2 in-progress"]],
      ]),
    ]);
    const issues = checkTasks(events, closed);
    expect(issues).toHaveLength(2);
    // The way out has to be spelled out, all three of it.
    expect(issues[0]?.message).toMatch(/FROM ANY LIVE THREAD/);
    expect(issues[0]?.message).toMatch(/reopen/);
  });

  it("it bites against the thread of the CURRENT status, not the owning one (В1)", () => {
    const status = new Map<string, "open" | "closed">([
      ["016-roadmap", "closed"],
      ["022-other", "open"],
    ]);
    const events = collectTaskEvents([
      input("016-roadmap", [["curator", "2026-07-28T10:00:00Z", ["016.3 open · R-пункт"]]]),
      input("022-other", [["dev-core", "2026-07-28T11:00:00Z", ["016.3 in-progress"]]]),
    ]);
    expect(checkTasks(events, status)).toEqual([]);
  });

  it("a foreign prefix on open, and one id said twice in one message", () => {
    const foreign = checkThreadTasks(
      input("021-native-tasks", [["curator", "2026-07-28T10:00:00Z", ["016.3 open · чужая"]]]),
    );
    expect(foreign[0]?.message).toMatch(/opened only under the id of its own thread/);

    const twice = checkThreadTasks(
      input("021-native-tasks", [
        ["curator", "2026-07-28T10:00:00Z", ["021.1 open · A", "021.1 in-progress"]],
      ]),
    );
    expect(twice[0]?.message).toMatch(/declared twice in one message/);
  });
});

describe("the board", () => {
  it("groups, links to the message FILE (П1) and speaks the truncation", () => {
    const entries: [string, string, string[]][] = [];
    for (let k = 1; k <= 17; k++) {
      const day = String(k).padStart(2, "0");
      entries.push(["curator", `2026-07-${day}T10:00:00Z`, [`021.${k} open · Задача ${k}`]]);
      entries.push(["dev-core", `2026-07-${day}T11:00:00Z`, [`021.${k} done · PR #${k}`]]);
    }
    const board = renderTasksBoard(
      foldTasks(collectTaskEvents([input("021-native-tasks", entries)])),
      new Map(),
    );
    expect(board).toContain("021-native-tasks/messages/");
    expect(board).toContain("всего done: 17, показаны последние 15");
    expect(board).not.toContain("_thread.md");
  });

  it("orders 'Предстоит' by the id as NUMBERS, so 021.10 stands after 021.9", () => {
    const entries: [string, string, string[]][] = [];
    for (const k of [1, 2, 9, 10, 11]) {
      entries.push(["curator", `2026-07-28T10:0${entries.length}:00Z`, [`021.${k} open · З ${k}`]]);
    }
    const board = renderTasksBoard(
      foldTasks(
        collectTaskEvents([
          input("021-native-tasks", entries),
          // Another owning thread, to pin that the NNN is compared as a number as well.
          input("016-roadmap", [["curator", "2026-07-28T10:09:00Z", ["016.3 open · R"]]]),
        ]),
      ),
      new Map(),
    );
    const upNext = board.slice(board.indexOf("## Предстоит"), board.indexOf("## Сделано"));
    const ids = [...upNext.matchAll(/\[(\d{3,}\.\d+)]/g)].map(([, id]) => id);
    expect(ids).toEqual(["016.3", "021.1", "021.2", "021.9", "021.10", "021.11"]);
  });

  it("has no clock: the same feed renders the same bytes", () => {
    const feed = [
      input("021-native-tasks", [["curator", "2026-07-28T10:00:00Z", ["021.1 open · A"]]]),
    ];
    const once = renderTasksBoard(foldTasks(collectTaskEvents(feed)), new Map());
    expect(renderTasksBoard(foldTasks(collectTaskEvents(feed)), new Map())).toBe(once);
  });

  it("shows the addressee of an open task from the thread's waiting-on (§2.3)", () => {
    const feed = [
      input("021-native-tasks", [["curator", "2026-07-28T10:00:00Z", ["021.1 open · A"]]]),
    ];
    const board = renderTasksBoard(
      foldTasks(collectTaskEvents(feed)),
      new Map([["021-native-tasks", "dev-core"]]),
    );
    expect(board).toContain("dev-core");
  });
});

describe("the assembled thread", () => {
  const meta = { title: "t", participants: ["curator"], status: "open" as const };
  const messages = [message("curator", "2026-07-28T10:00:00Z", ["021.1 open · A"])];

  it("does not move a byte for derive, and shows the declarations for a reader", () => {
    expect(renderThread(meta, messages)).not.toContain("tasks:");
    expect(renderThread(meta, messages, { tasks: true })).toContain("<!-- tasks: 021.1 → open -->");
  });
});
