import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { authenticateRequest, type RequestIdentity } from "@/lib/access-control";
import { appendAuditEvent } from "@/lib/audit";
import { buildCitations, generateGroundedAnswer } from "@/lib/answer";
import {
  beginChatTurn,
  chatConversationExists,
  completeChatTurn,
  getChatConversation,
} from "@/lib/chat-history";
import { resolveResearchQuestion } from "@/lib/conversation";
import { hasEffectiveReportAccess, listPurchasedReportIds } from "@/lib/demo-purchases";
import { getPermissionDecisionForReports } from "@/lib/permissions";
import { consumeRequestQuota } from "@/lib/rate-limit";
import { listReports } from "@/lib/report-registry";
import { routeQuestionToReports } from "@/lib/report-router";
import { retrieveEvidence } from "@/lib/retrieval";
import type {
  AssistantResponse,
  ChatHistoryMessage,
  ChatStreamEvent,
  ReportDefinition,
  WorkflowStep,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  requestId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  question: z.string().trim().min(3).max(700),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4_000),
  })).max(8).default([]),
}).strict();

const reportSummary = (
  report: ReportDefinition,
): AssistantResponse["blockedReports"][number] => ({
  id: report.id,
  title: report.title,
  shortTitle: report.shortTitle,
  code: report.code,
  priceCents: report.priceCents,
  currency: report.currency,
});

type ProgressReporter = (step: WorkflowStep) => void;

function recordStep(
  workflow: WorkflowStep[],
  onProgress: ProgressReporter | undefined,
  step: WorkflowStep,
) {
  workflow.push(step);
  onProgress?.(step);
}

async function completeChat(
  identity: RequestIdentity,
  conversationId: string,
  requestId: string,
  question: string,
  onProgress?: ProgressReporter,
): Promise<AssistantResponse> {
  const user = identity.user;
  const userId = user.id;
  const workflow: WorkflowStep[] = [];
  const finish = async (response: AssistantResponse): Promise<AssistantResponse> => {
    await completeChatTurn({ conversationId, requestId, userId, response });
    return response;
  };

  recordStep(workflow, onProgress, {
    id: "identity",
    label: "Identity resolved",
    detail: `${user.name} · ${user.organization}`,
    status: "complete",
  });

  const [reports, purchasedReportIds] = await Promise.all([
    listReports(),
    listPurchasedReportIds(userId),
  ]);
  const allowedReportIds = new Set(
    reports
      .filter((report) => hasEffectiveReportAccess(report, userId, purchasedReportIds))
      .map((report) => report.id),
  );
  const storedConversation = await getChatConversation(userId, conversationId, allowedReportIds);
  const history: ChatHistoryMessage[] = (storedConversation?.messages ?? [])
    .filter((message) => message.id !== `user-${requestId}`)
    .slice(-8)
    .map(({ role, content }) => ({ role, content: content.slice(0, 4_000) }));
  const researchQuestion = resolveResearchQuestion(question, history);
  const routing = await routeQuestionToReports(researchQuestion, reports);
  const routedCodes = routing.reportIds
    .map((reportId) => reports.find((report) => report.id === reportId)?.code)
    .filter(Boolean)
    .join(", ");
  const routingTarget = routing.reportIds.length
    ? `${routing.reportIds.length} candidate ${routing.reportIds.length === 1 ? "report" : "reports"} · ${routedCodes}`
    : "Broad authorized-catalog search";
  const routingConfidence = routing.confidence === null
    ? ""
    : ` · ${Math.round(routing.confidence * 100)}% confidence`;

  recordStep(workflow, onProgress, {
    id: "route",
    label: routing.mode === "ai" ? "AI report routing complete" : "Metadata routing fallback",
    detail: `${routingTarget}${routingConfidence}`,
    status: routing.mode === "ai" ? "complete" : "warning",
  });

  const decision = getPermissionDecisionForReports(
    userId,
    reports,
    routing.reportIds,
    purchasedReportIds,
  );
  const blockedReports = decision.blocked.map(reportSummary);
  recordStep(workflow, onProgress, {
    id: "authorize",
    label: "Entitlements checked",
    detail: decision.blocked.length
      ? `${decision.authorized.length} licensed · ${decision.blocked.length} relevant source excluded`
      : `${decision.authorized.length} of ${decision.authorized.length} licensed sources available`,
    status: decision.blocked.length ? "warning" : "complete",
  });

  if (decision.searchable.length === 0) {
    const hasPermissionBlock = decision.blocked.length > 0;
    recordStep(workflow, onProgress, {
      id: "retrieve",
      label: "Retrieval stopped",
      detail: hasPermissionBlock
        ? "No requested report passed the permission check"
        : "No report in the folder is licensed to this identity",
      status: "blocked",
    });
    const audit = await appendAuditEvent({
      userId,
      action: hasPermissionBlock ? "query.denied" : "query.unsupported",
      question,
      searchedReports: [],
      blockedReports: decision.blocked.map((report) => report.id),
      citationCount: 0,
      mode: "policy",
      reasonCode: hasPermissionBlock ? "REPORT_NOT_LICENSED" : "NO_LICENSED_REPORTS",
      routingMode: routing.mode,
      routingConfidence: routing.confidence,
      routedReports: routing.reportIds,
    });
    return finish({
      conversationId,
      answer: hasPermissionBlock
        ? `I can’t search the requested ${decision.blocked.length === 1 ? "report" : "reports"} for this account. ${decision.blocked.map((report) => report.shortTitle).join(" and ")} ${decision.blocked.length === 1 ? "is" : "are"} not included in ${user.organization}’s current entitlements. No report content was opened and no answer was generated.`
        : "This identity currently has no licensed reports in the server folder. Add a supported file to data/reports or update its allowedUsers entry in data/reports.config.json.",
      citations: [],
      workflow,
      blockedReports,
      noAnswer: true,
      mode: "policy",
      auditId: audit.id,
    });
  }

  const { chunks, scannedCount } = await retrieveEvidence(decision.searchable, researchQuestion);
  recordStep(workflow, onProgress, {
    id: "retrieve",
    label: "Licensed research searched",
    detail: `${scannedCount.toLocaleString()} sections across ${decision.searchable.length} ${decision.searchable.length === 1 ? "report" : "reports"}`,
    status: "complete",
  });

  const usableChunks = chunks.filter((chunk) => chunk.score >= 3.2).slice(0, 6);
  if (usableChunks.length === 0) {
    recordStep(workflow, onProgress, {
      id: "ground",
      label: "Evidence threshold not met",
      detail: "No sufficiently relevant passage was found",
      status: "blocked",
    });
    const audit = await appendAuditEvent({
      userId,
      action: "query.unsupported",
      question,
      searchedReports: decision.searchable.map((report) => report.id),
      blockedReports: decision.blocked.map((report) => report.id),
      citationCount: 0,
      mode: "grounded",
      reasonCode: "NO_RELEVANT_EVIDENCE",
      routingMode: routing.mode,
      routingConfidence: routing.confidence,
      routedReports: routing.reportIds,
    });
    return finish({
      conversationId,
      answer: "I couldn’t find enough relevant evidence in the research this account can access. Try naming a device category, metric, company, geography, or forecast period. I won’t substitute an unsupported estimate.",
      citations: [],
      workflow,
      blockedReports,
      noAnswer: true,
      mode: "grounded",
      auditId: audit.id,
    });
  }

  const citations = buildCitations(usableChunks, researchQuestion);
  recordStep(workflow, onProgress, {
    id: "ground",
    label: "Evidence grounded",
    detail: `${citations.length} passages selected with source metadata`,
    status: "complete",
  });

  const generated = await generateGroundedAnswer({
    question,
    researchQuestion,
    history,
    chunks: usableChunks,
    citations,
    user,
    blocked: decision.blocked,
  });
  recordStep(workflow, onProgress, {
    id: "generate",
    label: generated.mode === "live"
      ? "OpenAI response generated"
      : generated.mode === "verified"
        ? "Verified calculation generated"
        : "Demo synthesis generated",
    detail:
      generated.mode === "live"
        ? "Grounded prompt · API key remained server-side"
        : generated.mode === "verified"
          ? "Server-side arithmetic · grounded in cited report values"
          : "Deterministic fallback · add OPENAI_API_KEY for live generation",
    status: decision.blocked.length ? "warning" : "complete",
  });

  const audit = await appendAuditEvent({
    userId,
    action: decision.blocked.length ? "query.partial" : "query.completed",
    question,
    searchedReports: decision.searchable.map((report) => report.id),
    blockedReports: decision.blocked.map((report) => report.id),
    citationCount: citations.length,
    mode: generated.mode,
    reasonCode: decision.blocked.length ? "PARTIAL_ENTITLEMENT" : "ACCESS_GRANTED",
    routingMode: routing.mode,
    routingConfidence: routing.confidence,
    routedReports: routing.reportIds,
  });

  return finish({
    conversationId,
    answer: generated.answer,
    citations,
    workflow,
    blockedReports,
    noAnswer: false,
    mode: generated.mode,
    auditId: audit.id,
  });
}

function streamChat(
  identity: RequestIdentity,
  conversationId: string,
  requestId: string,
  question: string,
): Response {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ChatStreamEvent) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      };

      void completeChat(identity, conversationId, requestId, question, (step) => emit({ type: "progress", step }))
        .then((response) => emit({ type: "result", response }))
        .catch((error: unknown) => {
          console.error("Chat workflow failed after streaming started.", {
            name: error instanceof Error ? error.name : "Error",
          });
          emit({
            type: "error",
            error: "The assistant request failed while processing the secure workflow.",
          });
        })
        .finally(() => {
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Conversation-Id": conversationId,
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: NextRequest) {
  const identity = authenticateRequest(request);
  if (!identity) {
    return NextResponse.json({ error: "A valid signed session is required." }, { status: 401 });
  }

  const quota = consumeRequestQuota(identity.session.sessionId);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: "Too many assistant requests. Please wait a moment and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(quota.retryAfterSeconds),
          "X-RateLimit-Limit": String(quota.limit),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 64 * 1_024) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a question between 3 and 700 characters using the supported request format." },
      { status: 400 },
    );
  }

  const { question, requestId = randomUUID() } = parsed.data;
  const conversationId = parsed.data.conversationId ?? randomUUID();
  if (parsed.data.conversationId
    && !(await chatConversationExists(identity.user.id, parsed.data.conversationId))) {
    return NextResponse.json({ error: "The selected conversation was not found." }, { status: 404 });
  }
  await beginChatTurn({
    conversationId,
    requestId,
    userId: identity.user.id,
    question,
  });
  if (request.headers.get("accept")?.includes("text/event-stream")) {
    return streamChat(identity, conversationId, requestId, question);
  }

  return NextResponse.json(await completeChat(identity, conversationId, requestId, question));
}
