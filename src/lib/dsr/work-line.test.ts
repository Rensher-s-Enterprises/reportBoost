import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyPunch } from "./timeline.ts";
import { formatWorkPerformedLine } from "./work-line.ts";

describe("formatWorkPerformedLine", () => {
  it("does not repeat nick, code, or Closed when the punch already says them", () => {
    const line = formatWorkPerformedLine(
      emptyPunch({
        time: "0800",
        endTime: "0930",
        text: "Nick closed CHK-863-1 after replacing the bent A-phase finger.",
        cxalloy: "CHK-863-1",
        closed: true,
        workers: ["Nick Matthews"],
      }),
    );
    assert.match(line, /^0800–0930/);
    assert.match(line, /Nick closed CHK-863-1/);
    assert.equal((line.match(/CHK-863-1/g) || []).length, 1);
    assert.doesNotMatch(line, /\[Nick Matthews\]/);
    assert.doesNotMatch(line, / Closed\.$/);
  });

  it("adds the code only when the sentence omitted it", () => {
    const line = formatWorkPerformedLine(
      emptyPunch({
        time: "1000",
        text: "Torque checked the ground bus hardware.",
        cxalloy: "FO-24-24",
        workers: [],
      }),
    );
    assert.match(line, /FO-24-24/);
    assert.doesNotMatch(line, /\[/);
  });

  it("lists every CXAlloy code on a multi-issue punch", () => {
    const line = formatWorkPerformedLine(
      emptyPunch({
        time: "1100",
        endTime: "1400",
        text: "Worked labels and latches on the ATC lineup.",
        cxalloys: ["CHK-863-1", "FO-24-24"],
        closedCodes: ["CHK-863-1"],
        workers: [],
      }),
    );
    assert.match(line, /CHK-863-1/);
    assert.match(line, /FO-24-24/);
    assert.match(line, /Closed/);
  });
});
