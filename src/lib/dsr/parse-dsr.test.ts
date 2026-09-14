import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignPhotosToCodes, cleanField, jobFromFilename, parseDsrText } from "./parse-dsr.ts";

const official = `DAILY SERVICE REPORT
Date: 09.04.2026 WO: 28460 P.O. Number:
Customer: DVM (Holder Mustang) Charge Code:
Location: LaGrange, GA Type of Transportation: Rental Car / Flight / Service Truck
Generator Size: N/A Qty: N/A Operating Voltage: 480 DC Voltage: 125
Switchgear Manufacturer: DVM Prints or Job # & Date: R69780 Date: 02.02.26
Job Task: Travel to the integration site to conduct pre commissioning check list on LV switchgear.
Work Performed:
0700: We arrived at the job site and gathered our tools and supplies from the trucks.
0730: We completed our toolbox talk and JSA for the day.
Material Used: N/A
Parts Needed/Delivery Required: See parts list.
Time On: 0700 Time Off: 2000 Estimated Cost: N/A Mileage Total (Round Trip): N/A
Technician: Rene Morales Hernandez Customer:
Name/Employee ID Name
Comments: Pre-commissioning work day. Crew on site: John Thatcher, Nick Matthews, Jerry Scott.
No.: 090426RMH
`;

const oldScan = `Location:
Job Task: Travel to the integration site to conduct pre commissioning check list on LV switchgear.
Work Performed:
0700: We arrived at the job site and gathered our tools and supplies from the trucks.
0730: We completed our toll box talk and JSA for the day.
Material Used: N/A
Parts Needed/Delivery Required: See parts list.
Time On: 0700 Time Off: 2000 Estimated Cost: N/A Mileage Total (Round Trip): N/A
John Thatcher / 52414
Nick Matthews
Jerry Scott
Technician: Rene Morales Hernandez Customer:
Name/Employee ID Name
Comments:
No.: 090426RMH
`;

describe("parseDsrText header / job fields", () => {
  it("reads customer, WO, location and task from a clean official header", () => {
    const p = parseDsrText(official, "DSR_DVM_Holder_Mustang_090426RMH_WO28460.pdf");
    assert.equal(p.customer, "DVM (Holder Mustang)");
    assert.equal(p.wo, "28460");
    assert.equal(p.location, "LaGrange, GA");
    assert.match(p.jobTask, /pre commissioning/i);
    assert.equal(p.technician, "Rene Morales Hernandez");
    assert.equal(p.operatingVoltage, "480");
    assert.equal(p.switchgearMfr, "DVM");
  });

  it("does not use the empty signature Customer or Name/Employee ID as the job", () => {
    const p = parseDsrText(oldScan, "daly report 09.04.2026 (1).pdf");
    assert.equal(p.customer, "");
    assert.equal(p.wo, "");
    assert.equal(p.location, "");
    assert.match(p.jobTask, /pre commissioning/i);
    assert.equal(p.technician, "Rene Morales Hernandez");
    assert.ok(p.crewToday.some((n) => /john thatcher/i.test(n)));
    assert.ok(p.crewToday.some((n) => /nick matthews/i.test(n)));
    assert.ok(!p.crewToday.some((n) => /job complete/i.test(n)));
  });

  it("does not treat issue notes like OTHERS (RENE) as the customer", () => {
    const messy = `${oldScan}\n0830: CHK-269-2 VERIFIED THAT HAS BEEN DONE BY OTHERS (RENE)\n`;
    const p = parseDsrText(messy, "DALY REPORT RM090826.pdf");
    assert.equal(p.customer, "");
  });

  it("fills customer and WO from the filename when the scanned header is empty", () => {
    const p = parseDsrText(oldScan, "DSR DVM (Holder Mustang) 090426JET WO#28460.pdf");
    assert.equal(p.customer, "DVM (Holder Mustang)");
    assert.equal(p.wo, "28460");
  });

  it("parses DSR filenames with underscores and WO suffix", () => {
    const named = jobFromFilename("DSR_DVM_Holder_Mustang_090526RMH_WO28460.pdf");
    assert.equal(named.wo, "28460");
    assert.match(named.customer, /dvm/i);
    assert.match(named.customer, /mustang/i);
  });
});

describe("parseWorkPerformed multiple CXAlloy codes", () => {
  it("keeps every code on a punch that names more than one", () => {
    const p = parseDsrText(
      `${official.replace("Work Performed:", "Work Performed:\n1100: Worked labels and latches (CHK-863-1, FO-24-24).")}`,
      "DSR_DVM_Holder_Mustang_090426RMH_WO28460.pdf",
    );
    const hit = p.entries.find((e) => e.time === "1100");
    assert.ok(hit);
    assert.equal(hit?.cxalloy, "CHK-863-1");
    assert.deepEqual(hit?.cxalloys, ["CHK-863-1", "FO-24-24"]);
  });
});

describe("cleanField keeps names with accents", () => {
  it("does not strip José / Muñoz", () => {
    assert.equal(cleanField("José Muñoz"), "José Muñoz");
  });
});

describe("assignPhotosToCodes", () => {
  it("carries the last CHK code onto a photo-only following page", () => {
    const photo = { mime: "image/jpeg" as const, dataB64: "aaaa", bytes: 12 };
    const mapped = assignPhotosToCodes([
      { text: "CHK-284-6 IN PROGRESS Tags are reversed", photos: [photo] },
      { text: "see pictures for details", photos: [{ mime: "image/jpeg", dataB64: "bbbb", bytes: 13 }] },
    ]);
    const row = mapped.find((m) => m.code === "CHK-284-6");
    assert.equal(row?.photos.length, 2);
  });
});
