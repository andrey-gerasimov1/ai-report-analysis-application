import { describe, expect, it } from "vitest";
import { getAuthorizedReports, getPermissionDecision } from "@/lib/permissions";

describe("report entitlements", () => {
  it("gives the strategy director both reports", async () => {
    expect((await getAuthorizedReports("alex")).map((report) => report.id)).toEqual(
      expect.arrayContaining(["report-storage", "report-robotics"]),
    );
  });

  it("stops a storage-only user before robotics retrieval", async () => {
    const decision = await getPermissionDecision(
      "jordan",
      "Who leads the warehouse robotics market?",
    );

    expect(decision.searchable).toHaveLength(0);
    expect(decision.blocked.map((report) => report.id)).toEqual(["report-robotics"]);
  });

  it("permits only the entitled half of a cross-report request", async () => {
    const decision = await getPermissionDecision(
      "jordan",
      "Compare grid storage and warehouse robotics growth.",
    );

    expect(decision.searchable.map((report) => report.id)).toEqual(["report-storage"]);
    expect(decision.blocked.map((report) => report.id)).toEqual(["report-robotics"]);
  });
});
