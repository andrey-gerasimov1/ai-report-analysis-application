import { describe, expect, it } from "vitest";
import { getPermissionDecisionForReports } from "@/lib/permissions";
import { listReports } from "@/lib/report-registry";
import { buildSafeRoutingCatalog, routeQuestionToReports } from "@/lib/report-router";

describe("AI-first report routing boundary", () => {
  it("uses deterministic metadata routing when AI routing is unavailable", async () => {
    const reports = await listReports();
    const routing = await routeQuestionToReports(
      "Compare DEMO-STORAGE-01 with DEMO-ROBOTICS-02.",
      reports,
    );

    expect(routing.mode).toBe("metadata");
    expect(routing.reportIds).toEqual(expect.arrayContaining(["report-storage", "report-robotics"]));
  });

  it("never includes ACLs or server filenames in model-visible catalog metadata", async () => {
    const catalogJson = JSON.stringify(buildSafeRoutingCatalog(await listReports()));
    expect(catalogJson).not.toContain("allowedUsers");
    expect(catalogJson).not.toContain("filename");
    expect(catalogJson).not.toContain("version");
  });

  it("treats routed report IDs as candidates and still applies entitlements", async () => {
    const reports = await listReports();
    const decision = getPermissionDecisionForReports(
      "jordan",
      reports,
      ["report-robotics", "report-does-not-exist"],
    );

    expect(decision.searchable).toHaveLength(0);
    expect(decision.blocked.map((report) => report.id)).toEqual(["report-robotics"]);
  });

  it("treats a simulated purchase as an entitlement without changing the report ACL", async () => {
    const reports = await listReports();
    const decision = getPermissionDecisionForReports(
      "jordan",
      reports,
      ["report-robotics"],
      new Set(["report-robotics"]),
    );

    expect(decision.blocked).toHaveLength(0);
    expect(decision.searchable.map((report) => report.id)).toEqual(["report-robotics"]);
    expect(reports.find((report) => report.id === "report-robotics")?.allowedUsers).not.toContain("jordan");
  });
});
