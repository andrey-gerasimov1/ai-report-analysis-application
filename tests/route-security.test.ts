import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as chat } from "@/app/api/chat/route";
import { GET as getContext } from "@/app/api/context/route";
import { DELETE as deleteHistory, GET as getHistory } from "@/app/api/history/route";
import { POST as purchaseReports } from "@/app/api/purchases/route";
import { GET as viewReport } from "@/app/api/reports/[reportId]/view/route";
import { POST as createSession } from "@/app/api/session/route";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/session";

const SECRET = "route-test-session-secret-with-at-least-32-characters";

function request(
  url: string,
  userId: "alex" | "jordan" | "taylor",
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  const token = createSessionToken(userId, { secret: SECRET });
  return new NextRequest(url, {
    ...init,
    headers: {
      Cookie: `${SESSION_COOKIE_NAME}=${token}`,
      ...(init.headers ?? {}),
    },
  });
}

describe("route-level authorization", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  it("issues an HTTP-only, strict same-site signed session", async () => {
    const response = await createSession(new NextRequest("http://localhost/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "jordan" }),
    }));
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it("stops an unlicensed report request before retrieval or OpenAI generation", async () => {
    const response = await chat(request("http://localhost/api/chat", "jordan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: "Who leads the warehouse robotics market?",
        history: [],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      mode: "policy",
      noAnswer: true,
      citations: [],
    });
    expect(body.blockedReports.map((report: { id: string }) => report.id)).toEqual(["report-robotics"]);
  });

  it("streams real server workflow completions in execution order", async () => {
    const response = await chat(request("http://localhost/api/chat", "jordan", {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: "Who leads the warehouse robotics market?",
        history: [],
      }),
    }));
    const events = (await response.text())
      .split("\n\n")
      .map((block) => block.split("\n").find((line) => line.startsWith("data:")))
      .filter((line): line is string => Boolean(line))
      .map((line) => JSON.parse(line.slice(5).trim()));

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events.filter((event) => event.type === "progress").map((event) => event.step.id))
      .toEqual(["identity", "route", "authorize", "retrieve"]);
    expect(events.at(-1)).toMatchObject({
      type: "result",
      response: { mode: "policy", noAnswer: true },
    });
  });

  it("scopes stored history reads and clears to the signed identity", async () => {
    const signedJordanRequest = request("http://localhost/api/history?userId=alex", "jordan");
    const response = await getHistory(signedJordanRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).not.toHaveLength(0);
    expect(body.messages[0].content).toBe("Who leads the warehouse robotics market?");

    expect((await deleteHistory(request("http://localhost/api/history?userId=alex", "jordan"))).status)
      .toBe(200);
    expect((await (await getHistory(request("http://localhost/api/history", "jordan"))).json()).messages)
      .toEqual([]);
  });

  it("rejects attempts to override the signed identity in a chat body", async () => {
    const response = await chat(request("http://localhost/api/chat", "jordan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "alex",
        question: "Who leads the warehouse robotics market?",
        history: [],
      }),
    }));

    expect(response.status).toBe(400);
  });

  it("rejects a conversation ID that does not belong to the signed identity", async () => {
    const response = await chat(request("http://localhost/api/chat", "jordan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: "e6dab76e-1aa9-4e7a-9dc8-b25ec50d9962",
        question: "Continue this conversation",
        history: [],
      }),
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "The selected conversation was not found." });
  });

  it("ignores query-string impersonation when returning workspace context", async () => {
    const response = await getContext(
      request("http://localhost/api/context?userId=alex", "jordan"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.id).toBe("jordan");
    expect(body.sessionType).toBe("signed-demo");
  });

  it("ignores query-string impersonation on the document viewer", async () => {
    const response = await viewReport(
      request("http://localhost/api/reports/report-robotics/view?userId=alex", "jordan"),
      { params: Promise.resolve({ reportId: "report-robotics" }) },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("not licensed");
  });

  it("requires a signed session for protected report content", async () => {
    const response = await viewReport(
      new NextRequest("http://localhost/api/reports/report-storage/view"),
      { params: Promise.resolve({ reportId: "report-storage" }) },
    );
    expect(response.status).toBe(401);
  });

  it("adds a purchased report to the signed user's server-enforced entitlements", async () => {
    const response = await purchaseReports(request("http://localhost/api/purchases", "jordan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportIds: ["report-robotics"] }),
    }));
    const receipt = await response.json();

    expect(response.status).toBe(200);
    expect(receipt).toMatchObject({
      currency: "USD",
      totalCents: 24_900,
      purchasedReportIds: ["report-robotics"],
      allRequestedReportsAccessible: true,
    });

    const context = await (await getContext(request("http://localhost/api/context", "jordan"))).json();
    expect(context.reports.find((report: { id: string }) => report.id === "report-robotics").accessible)
      .toBe(true);

    const reportResponse = await viewReport(
      request("http://localhost/api/reports/report-robotics/view", "jordan"),
      { params: Promise.resolve({ reportId: "report-robotics" }) },
    );
    expect(reportResponse.status).toBe(200);
  });
});
