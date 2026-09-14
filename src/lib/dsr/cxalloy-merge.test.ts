import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferDisposition, mergeCxalloySeeds, type IssueSeed } from "./cxalloy.ts";

function seed(over: Partial<IssueSeed> & { code: string }): IssueSeed {
  return {
    title: over.title || over.code,
    description: "",
    status: "in_progress",
    statusLabel: "IN PROGRESS",
    priority: "",
    priorityLabel: "",
    assignedTo: "",
    asset: "",
    discipline: "",
    type: "",
    dueDate: "",
    createdBy: "",
    identifiedOn: "",
    ...over,
  };
}

describe("inferDisposition", () => {
  it("flags reassigned scope", () => {
    assert.equal(inferDisposition("Reassigning to Holder — not MCG scope").disposition, "reassigned");
  });
  it("flags as-designed", () => {
    assert.equal(
      inferDisposition("Inspector called this an issue but that is how it was designed.").disposition,
      "as_designed",
    );
  });
});

describe("mergeCxalloySeeds", () => {
  it("promotes status to closed when the LLM reads CLOSED", () => {
    const out = mergeCxalloySeeds(
      [seed({ code: "CHK-863-1", title: "Bent finger", status: "in_progress" })],
      [{ code: "CHK-863-1", status: "fixed", asset: "PMDC B-2" }],
    );
    assert.equal(out[0]?.status, "fixed");
    assert.equal(out[0]?.asset, "PMDC B-2");
  });

  it("replaces a photo-filename title", () => {
    const out = mergeCxalloySeeds(
      [seed({ code: "CHK-1", title: "20260806_170918790_iOS.jpg" })],
      [{ code: "CHK-1", title: "Front left cover bowed inward" }],
    );
    assert.match(out[0]?.title || "", /bowed/i);
  });
});
