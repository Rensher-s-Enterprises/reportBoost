import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { entryMarksIssueClosed, hhmmToMin } from "./timeline.ts";
import { normalizeHhmm } from "../utils.ts";

describe("normalizeHhmm", () => {
  it("expands short times to HHMM", () => {
    assert.equal(normalizeHhmm("7"), "0700");
    assert.equal(normalizeHhmm("7:00"), "0700");
    assert.equal(normalizeHhmm("700"), "0700");
    assert.equal(normalizeHhmm("0730"), "0730");
    assert.equal(normalizeHhmm("19:45"), "1945");
  });
});

describe("hhmmToMin uses normalized times", () => {
  it("treats 7 as 07:00", () => {
    assert.equal(hhmmToMin("7"), 7 * 60);
  });
});

describe("entryMarksIssueClosed", () => {
  it("does not treat worksite closed as closing an issue", () => {
    assert.equal(
      entryMarksIssueClosed({
        cxalloy: "CHK-123",
        text: "We remained on site on standby because the worksite was closed.",
      }),
      false,
    );
  });

  it("treats marked-fixed language as closed", () => {
    assert.equal(
      entryMarksIssueClosed({
        cxalloy: "CHK-863-1",
        text: "Rene completed work on the bent finger (CHK-863-1) and marked the issue fixed.",
      }),
      true,
    );
  });

  it("honors the closed flag", () => {
    assert.equal(entryMarksIssueClosed({ closed: true, cxalloy: "CHK-1", text: "Anything" }), true);
  });
});
