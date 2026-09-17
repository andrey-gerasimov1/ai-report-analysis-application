import { describe, expect, it } from "vitest";
import { buildCitations } from "@/lib/answer";
import { getPermissionDecision } from "@/lib/permissions";
import { retrieveEvidence } from "@/lib/retrieval";

describe("authorized retrieval", () => {
  it("returns relevant storage evidence without crossing the entitlement boundary", async () => {
    const decision = await getPermissionDecision(
      "jordan",
      "What is the grid storage market value and CAGR?",
    );
    const result = await retrieveEvidence(decision.searchable, "grid storage market value CAGR");

    expect(result.scannedCount).toBeGreaterThan(0);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks.every((chunk) => chunk.documentId === "report-storage")).toBe(true);
    expect(result.chunks[0].anchor).toMatch(/^_Toc|^report-analysis-/);
    expect(result.chunks[0].text).toMatch(/\$420 million|7\.6%|grid storage/i);
  });

  it("keeps table figures together so market-share claims point to the actual values", async () => {
    const question = "Who leads warehouse robotics market share: Orion Robotics or Vela Automation?";
    const decision = await getPermissionDecision("taylor", question);
    const result = await retrieveEvidence(decision.searchable, question);
    const shareChunk = result.chunks.find((chunk) =>
      chunk.text.includes("62.5%") && chunk.text.includes("24.0%"),
    );

    expect(shareChunk?.section).toMatch(/market share/i);
    const citation = buildCitations([shareChunk!], question)[0];
    expect(citation.figures).toEqual(expect.arrayContaining(["62.5%", "24.0%"]));
    expect(citation.anchor).toMatch(/^_Toc|^report-analysis-/);
  });
});
