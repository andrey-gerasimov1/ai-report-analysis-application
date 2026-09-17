import { describe, expect, it } from "vitest";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  listQuarantinedReportFiles,
  listReports,
  REPORTS_DIRECTORY,
} from "@/lib/report-registry";

describe("drop-in report registry", () => {
  it("discovers supported report files and ignores its README", async () => {
    const reports = await listReports();
    expect(reports.map((report) => report.filename)).toEqual(
      expect.arrayContaining(["sample-grid-storage.html", "sample-warehouse-robotics.html"]),
    );
    expect(reports.some((report) => report.filename.toLowerCase() === "readme.md")).toBe(false);
  });

  it("quarantines files that do not have an explicit manifest entry", async () => {
    const filename = "unregistered-security-test.txt";
    const filePath = path.join(REPORTS_DIRECTORY, filename);
    await writeFile(filePath, "This report must not be opened or indexed before registration.", "utf8");
    try {
      expect(await listQuarantinedReportFiles()).toContain(filename);
      expect((await listReports()).some((report) => report.filename === filename)).toBe(false);
    } finally {
      await unlink(filePath);
    }
  });
});
