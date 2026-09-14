import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  entryClosedCodes,
  entryIssueCodes,
  issueEvidenceCaption,
  photoCaptionLabel,
  photoPdfCaption,
  stampIssueCodes,
} from "./cxalloy.ts";
import { fleshOutDay } from "./polish.ts";
import { emptyPunch } from "./timeline.ts";

describe("issueEvidenceCaption", () => {
  it("labels the photo with only the CXAlloy code", () => {
    const caption = issueEvidenceCaption({
      code: "CHK-863-1",
      title: "Bent A-phase finger",
      description: "SDC B-2 Tie UT has a bent A-phase finger that needs replacement.",
    });
    assert.equal(caption, "CHK-863-1");
  });
});

describe("photoCaptionLabel", () => {
  it("does not repeat the code when the caption is already the code", () => {
    assert.equal(photoCaptionLabel("CHK-863-1", "CHK-863-1"), "CHK-863-1");
  });

  it("keeps extra caption text when it is more than the code", () => {
    assert.equal(photoCaptionLabel("CHK-863-1", "after torque"), "CHK-863-1 · after torque");
  });
});

describe("photoPdfCaption", () => {
  it("prints only the CXAlloy code even when the stored caption is long", () => {
    assert.equal(
      photoPdfCaption(
        "CHK-863-1",
        "CHK-863-1 — Bent A-phase finger. SDC B-2 Tie UT has a bent A-phase finger that needs replacement.",
      ),
      "CHK-863-1",
    );
  });

  it("pulls the code out of a legacy caption when the tag is empty", () => {
    assert.equal(
      photoPdfCaption("", "FO-24-24 — Ground bus hardware. Missing 1/2 inch hardware."),
      "FO-24-24",
    );
  });

  it("leaves untagged site photos unlabeled", () => {
    assert.equal(photoPdfCaption("", "North lineup after lunch"), "");
  });
});

describe("fleshOutDay", () => {
  it("expands a thin CHK-only punch using the issue title", () => {
    const entry = emptyPunch({
      id: "e1",
      time: "0800",
      text: "CHK-863-1",
      cxalloy: "CHK-863-1",
      closed: true,
      workers: ["Rene Morales Hernandez"],
    });
    const out = fleshOutDay({
      entries: [entry],
      issues: [
        {
          code: "CHK-863-1",
          title: "Bent A-phase finger",
          description: "Replace the bent finger in SDC B-2 Tie UT.",
          status: "fixed",
        },
      ],
      comments: "Work day.",
      crew: ["Rene Morales Hernandez"],
    });
    assert.equal(out.entries[0]?.id, "e1");
    assert.match(out.entries[0]?.text || "", /Bent A-phase finger/);
    assert.match(out.entries[0]?.text || "", /CHK-863-1/);
    assert.match(out.entries[0]?.text || "", /fixed|closed/i);
    assert.match(out.comments, /Rene Morales Hernandez/);
  });

  it("softens all-caps field notes without dropping the code", () => {
    const entry = emptyPunch({
      id: "e2",
      time: "0900",
      text: "NICK AND JERRY CORRECTED THE GROUND BUS HARDWARE IN ALL PMDC LINEUPS",
      cxalloy: "FO-24-24",
      workers: ["Nick Matthews", "Jerry Scott"],
    });
    const out = fleshOutDay({
      entries: [entry],
      issues: [
        {
          code: "FO-24-24",
          title: "Ground bus hardware",
          description: "1/2 inch hardware missing on ground bus connections.",
          status: "in_progress",
        },
      ],
      comments: "Pre-commissioning work day.",
      crew: ["Nick Matthews", "Jerry Scott"],
    });
    assert.match(out.entries[0]?.text || "", /Nick|Jerry|corrected/i);
    assert.doesNotMatch(out.entries[0]?.text || "", /NICK AND JERRY CORRECTED/);
    assert.match(out.entries[0]?.text || "", /FO-24-24/);
  });
});

describe("multiple CXAlloy codes on one punch", () => {
  it("stamps unique codes and closed subset", () => {
    const stamped = stampIssueCodes(["CHK-863-1", "FO-24-24", "CHK-863-1"]);
    assert.deepEqual(stamped.cxalloys, ["CHK-863-1", "FO-24-24"]);
    assert.equal(stamped.cxalloy, "CHK-863-1");
    const closed = entryClosedCodes({
      ...stamped,
      closed: false,
      closedCodes: ["FO-24-24"],
    });
    assert.deepEqual(closed, ["FO-24-24"]);
    assert.deepEqual(entryIssueCodes(stamped), ["CHK-863-1", "FO-24-24"]);
  });

  it("fleshes a thin multi-code punch without dropping a code", () => {
    const entry = emptyPunch({
      id: "e3",
      time: "1100",
      text: "",
      cxalloys: ["CHK-863-1", "FO-24-24"],
      closedCodes: ["CHK-863-1"],
      workers: ["Rene Morales Hernandez"],
    });
    const out = fleshOutDay({
      entries: [entry],
      issues: [
        {
          code: "CHK-863-1",
          title: "Bent A-phase finger",
          description: "Replace the bent finger.",
          status: "fixed",
        },
        {
          code: "FO-24-24",
          title: "Ground bus hardware",
          description: "Missing hardware.",
          status: "in_progress",
        },
      ],
      comments: "",
      crew: ["Rene Morales Hernandez"],
    });
    assert.match(out.entries[0]?.text || "", /CHK-863-1/);
    assert.match(out.entries[0]?.text || "", /FO-24-24/);
    assert.match(out.comments, /CHK-863-1/);
  });
});
