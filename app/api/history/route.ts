import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateRequest } from "@/lib/access-control";
import {
  clearChatHistory,
  deleteChatConversation,
  getChatConversation,
  listChatConversations,
} from "@/lib/chat-history";
import { hasEffectiveReportAccess, listPurchasedReportIds } from "@/lib/demo-purchases";
import { listReports } from "@/lib/report-registry";
import type { UserId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ConversationIdSchema = z.string().uuid();

async function allowedReportIds(userId: UserId): Promise<Set<string>> {
  const [reports, purchasedReportIds] = await Promise.all([
    listReports(),
    listPurchasedReportIds(userId),
  ]);
  return new Set(
    reports
      .filter((report) => hasEffectiveReportAccess(report, userId, purchasedReportIds))
      .map((report) => report.id),
  );
}

export async function GET(request: NextRequest) {
  const identity = authenticateRequest(request);
  if (!identity) {
    return NextResponse.json({ error: "A valid signed session is required." }, { status: 401 });
  }

  const requestedId = request.nextUrl.searchParams.get("conversationId");
  const parsedId = requestedId === null ? null : ConversationIdSchema.safeParse(requestedId);
  if (parsedId && !parsedId.success) {
    return NextResponse.json({ error: "Choose a valid conversation." }, { status: 400 });
  }

  const permittedReports = await allowedReportIds(identity.user.id);
  if (parsedId?.success) {
    const stored = await getChatConversation(
      identity.user.id,
      parsedId.data,
      permittedReports,
    );
    if (!stored) {
      return NextResponse.json({ error: "The selected conversation was not found." }, { status: 404 });
    }
    return NextResponse.json(stored, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const conversations = await listChatConversations(identity.user.id, permittedReports);
  const active = conversations[0]
    ? await getChatConversation(identity.user.id, conversations[0].id, permittedReports)
    : null;
  return NextResponse.json({
    conversations,
    activeConversationId: active?.conversation.id ?? null,
    messages: active?.messages ?? [],
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(request: NextRequest) {
  const identity = authenticateRequest(request);
  if (!identity) {
    return NextResponse.json({ error: "A valid signed session is required." }, { status: 401 });
  }

  const requestedId = request.nextUrl.searchParams.get("conversationId");
  if (requestedId === null) {
    await clearChatHistory(identity.user.id);
    return NextResponse.json(
      { cleared: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const parsedId = ConversationIdSchema.safeParse(requestedId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Choose a valid conversation." }, { status: 400 });
  }
  const removed = await deleteChatConversation(identity.user.id, parsedId.data);
  if (!removed) {
    return NextResponse.json({ error: "The selected conversation was not found." }, { status: 404 });
  }
  return NextResponse.json(
    { cleared: true, conversationId: parsedId.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
