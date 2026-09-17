import { describe, expect, it } from "vitest";
import { resolveResearchQuestion } from "@/lib/conversation";

describe("conversation follow-ups", () => {
  it("carries the last user request into a short contextual follow-up", () => {
    const resolved = resolveResearchQuestion("did you do the calculations though?", [
      {
        role: "user",
        content: "Compare Orion Robotics and Vela Automation's warehouse robotics market shares and calculate the percentage-point gap.",
      },
      { role: "assistant", content: "The comparison was incomplete." },
    ]);

    expect(resolved).toContain("Compare Orion Robotics and Vela Automation's warehouse robotics");
    expect(resolved).toContain("Follow-up: did you do the calculations though?");
  });

  it("does not contaminate a new standalone research question", () => {
    const question = "What is the grid storage market forecast for 2030?";
    expect(resolveResearchQuestion(question, [
      { role: "user", content: "Compare Orion Robotics and Vela Automation." },
    ])).toBe(question);
  });
});
