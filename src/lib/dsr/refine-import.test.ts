import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyPunch } from "./timeline.ts";
import type { ParsedDsr } from "./parse-dsr.ts";
import { matchIssueFromCatalog, mergeRefinedDsr, shouldRefineDsr } from "./refine-import.ts";

function base(over: Partial<ParsedDsr> = {}): ParsedDsr {
  return {
    workDate: "2026-09-04",
    reportNo: "090426RMH",
    timeOn: "0700",
    timeOff: "1530",
    mileage: "",
    estimatedCost: "",
    materialUsed: "",
    partsNeededText: "",
    comments: "",
    technician: "",
    customerSignName: "",
    entries: [],
    crewToday: [],
    customer: "",
    wo: "",
    location: "",
    po: "",
    chargeCode: "",
    transportation: "",
    generatorSize: "",
    qty: "",
    operatingVoltage: "",
    dcVoltage: "",
    switchgearMfr: "",
    prints: "",
    jobTask: "",
    ...over,
  };
}

describe("matchIssueFromCatalog", () => {
  it("returns empty when two issues are equally vague", () => {
    assert.equal(
      matchIssueFromCatalog("Continued field work on site.", [
        { code: "CHK-1", title: "Bent finger" },
        { code: "CHK-2", title: "Ground bus" },
      ]),
      "",
    );
  });
});

describe("shouldRefineDsr", () => {
  it("asks for help when punches lack CHK codes that appear in the PDF", () => {
    const parsed = base({
      customer: "Mustang",
      wo: "28460",
      entries: [emptyPunch({ time: "0800", text: "Replaced the bent A-phase finger." })],
    });
    assert.equal(
      shouldRefineDsr(
        parsed,
        "DAILY SERVICE REPORT Work Performed 0800 Replaced the bent A-phase finger CHK-863-1 and continued commissioning on the PMDC lineup after lunch.",
      ),
      true,
    );
  });

  it("skips a clean parse with codes already assigned", () => {
    const parsed = base({
      customer: "Mustang",
      wo: "28460",
      technician: "Rene",
      entries: [
        emptyPunch({ time: "0800", text: "Closed the bent finger.", cxalloy: "CHK-863-1" }),
        emptyPunch({ time: "1000", text: "Torque checks on ground bus.", cxalloy: "FO-24-24" }),
      ],
    });
    assert.equal(shouldRefineDsr(parsed, "plenty of text here for a daily service report header"), false);
  });
});

describe("mergeRefinedDsr", () => {
  it("does not overwrite a parser date", () => {
    const out = mergeRefinedDsr(base({ workDate: "2026-09-04" }), { workDate: "2026-01-01" });
    assert.equal(out.workDate, "2026-09-04");
  });

  it("fills WO and customer only when the parser left them blank", () => {
    const out = mergeRefinedDsr(base(), { customer: "DVM Holder Mustang", wo: "28460" });
    assert.equal(out.wo, "28460");
    assert.match(out.customer, /mustang/i);
  });

  it("assigns a catalog code only if the punch mentions it", () => {
    const parsed = base({
      wo: "28460",
      customer: "Mustang",
      entries: [emptyPunch({ time: "0800", text: "Replaced the bent A-phase finger on CHK-863-1." })],
    });
    const out = mergeRefinedDsr(
      parsed,
      { entries: [{ time: "0800", text: "Replaced the bent finger.", cxalloy: "CHK-863-1" }] },
      [{ code: "CHK-863-1", title: "Bent A-phase finger" }],
    );
    assert.equal(out.entries[0]?.cxalloy, "CHK-863-1");
  });

  it("assigns a catalog issue from the description when the code is missing", () => {
    const parsed = base({
      wo: "28460",
      customer: "Mustang",
      technician: "Rene",
      entries: [
        emptyPunch({
          time: "0800",
          text: "Replaced the bent A-phase finger on the SDC B-2 tie UT and marked it fixed.",
          closed: true,
        }),
      ],
    });
    const out = mergeRefinedDsr(parsed, {}, [
      {
        code: "CHK-863-1",
        title: "Bent A-phase finger",
        description: "SDC B-2 Tie UT has a bent A-phase finger that needs replacement.",
      },
      {
        code: "FO-24-24",
        title: "Ground bus hardware",
        description: "1/2 inch hardware missing on ground bus connections.",
      },
    ]);
    assert.equal(out.entries[0]?.cxalloy, "CHK-863-1");
    assert.equal(out.entries[0]?.closed, true);
  });

  it("does not invent a catalog code that is not in the punch", () => {
    const parsed = base({
      wo: "28460",
      customer: "Mustang",
      entries: [emptyPunch({ time: "0800", text: "Walked the lineup and took photos." })],
    });
    const out = mergeRefinedDsr(
      parsed,
      { entries: [{ time: "0800", cxalloy: "CHK-863-1", text: "Walked the lineup." }] },
      [{ code: "CHK-863-1", title: "Bent A-phase finger" }],
    );
    assert.equal(out.entries[0]?.cxalloy, "");
  });
});
