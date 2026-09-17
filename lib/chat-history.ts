import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  AssistantResponse,
  ChatConversationSummary,
  StoredChatMessage,
  UserId,
} from "@/lib/types";

const MAX_STORED_CONVERSATIONS = 20;
const MAX_STORED_TURNS = 25;
const HISTORY_DIRECTORY = path.join(process.cwd(), ".data", "chat-history");
const LEGACY_CONVERSATION_IDS: Record<UserId, string> = {
  alex: "10000000-0000-4000-8000-000000000001",
  jordan: "10000000-0000-4000-8000-000000000002",
  taylor: "10000000-0000-4000-8000-000000000003",
};

const CitationSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  title: z.string(),
  code: z.string(),
  section: z.string(),
  anchor: z.string(),
  sourceOffset: z.number().nullable(),
  excerpt: z.string(),
  figures: z.array(z.string()),
  relevance: z.number(),
});

const WorkflowStepSchema = z.object({
  id: z.enum(["identity", "route", "authorize", "retrieve", "ground", "generate"]),
  label: z.string(),
  detail: z.string(),
  status: z.enum(["complete", "warning", "blocked"]),
});

const PersistedAssistantResponseSchema = z.object({
  conversationId: z.string().uuid().optional(),
  answer: z.string(),
  citations: z.array(CitationSchema),
  workflow: z.array(WorkflowStepSchema),
  blockedReports: z.array(z.object({
    id: z.string(),
    title: z.string(),
    shortTitle: z.string().optional(),
    code: z.string(),
    priceCents: z.number().int().positive().default(19_900),
    currency: z.literal("USD").default("USD"),
  })),
  noAnswer: z.boolean(),
  mode: z.enum(["live", "verified", "demo", "policy", "grounded"]),
  auditId: z.string(),
});

const StoredTurnSchema = z.object({
  requestId: z.string().uuid(),
  userId: z.enum(["alex", "jordan", "taylor"]),
  createdAt: z.string().datetime(),
  userMessage: z.object({
    id: z.string(),
    role: z.literal("user"),
    content: z.string(),
  }),
  assistantMessage: z.object({
    id: z.string(),
    role: z.literal("assistant"),
    content: z.string(),
    response: PersistedAssistantResponseSchema,
  }).optional(),
});

const StoredConversationSchema = z.object({
  id: z.string().uuid(),
  userId: z.enum(["alex", "jordan", "taylor"]),
  title: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  turns: z.array(StoredTurnSchema).max(MAX_STORED_TURNS),
});

const StoredConversationsSchema = z.array(StoredConversationSchema);
const LegacyStoredTurnsSchema = z.array(StoredTurnSchema);
type StoredTurn = z.infer<typeof StoredTurnSchema>;
type StoredConversation = z.infer<typeof StoredConversationSchema>;

declare global {
  // eslint-disable-next-line no-var
  var __reportAnalysisChatConversations: Map<UserId, StoredConversation[]> | undefined;
  // eslint-disable-next-line no-var
  var __reportAnalysisChatHistoryWrites: Map<UserId, Promise<void>> | undefined;
}

const testConversations = globalThis.__reportAnalysisChatConversations
  ?? new Map<UserId, StoredConversation[]>();
const writeQueues = globalThis.__reportAnalysisChatHistoryWrites ?? new Map<UserId, Promise<void>>();
globalThis.__reportAnalysisChatConversations = testConversations;
globalThis.__reportAnalysisChatHistoryWrites = writeQueues;

function historyPath(userId: UserId): string {
  return path.join(HISTORY_DIRECTORY, `${userId}.json`);
}

function conversationTitle(question: string): string {
  const normalized = question.replace(/\s+/g, " ").trim();
  return normalized.length <= 52 ? normalized : `${normalized.slice(0, 51).trimEnd()}…`;
}

function migrateLegacyTurns(userId: UserId, turns: StoredTurn[]): StoredConversation[] {
  if (!turns.length) return [];
  const conversationId = LEGACY_CONVERSATION_IDS[userId];
  return [{
    id: conversationId,
    userId,
    title: conversationTitle(turns[0].userMessage.content),
    createdAt: turns[0].createdAt,
    updatedAt: turns.at(-1)?.createdAt ?? turns[0].createdAt,
    turns: turns.map((turn) => ({
      ...turn,
      ...(turn.assistantMessage ? {
        assistantMessage: {
          ...turn.assistantMessage,
          response: { ...turn.assistantMessage.response, conversationId },
        },
      } : {}),
    })),
  }];
}

async function readConversations(userId: UserId): Promise<StoredConversation[]> {
  if (process.env.NODE_ENV === "test") return testConversations.get(userId) ?? [];

  try {
    const raw = JSON.parse(await readFile(historyPath(userId), "utf8")) as unknown;
    const conversations = StoredConversationsSchema.safeParse(raw);
    if (conversations.success) return conversations.data;

    const legacyTurns = LegacyStoredTurnsSchema.safeParse(raw);
    if (legacyTurns.success) return migrateLegacyTurns(userId, legacyTurns.data);
    console.warn("Ignored invalid stored chat history.", { userId });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") console.error("Could not read stored chat history.", { userId, code });
  }
  return [];
}

async function writeConversations(
  userId: UserId,
  conversations: StoredConversation[],
): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    testConversations.set(userId, conversations);
    return;
  }

  await mkdir(HISTORY_DIRECTORY, { recursive: true });
  await writeFile(historyPath(userId), JSON.stringify(conversations, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function queueWrite(userId: UserId, operation: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  writeQueues.set(userId, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(userId) === next) writeQueues.delete(userId);
  }
}

async function settledConversations(userId: UserId): Promise<StoredConversation[]> {
  await writeQueues.get(userId)?.catch(() => undefined);
  return readConversations(userId);
}

function visibleTurns(
  conversation: StoredConversation,
  allowedReportIds?: ReadonlySet<string>,
): StoredTurn[] {
  return conversation.turns.filter((turn) => !allowedReportIds
    || !turn.assistantMessage
    || turn.assistantMessage.response.citations.every(
      (citation) => allowedReportIds.has(citation.documentId),
    ));
}

function summaryFor(
  conversation: StoredConversation,
  turns: StoredTurn[],
): ChatConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: turns.reduce((count, turn) => count + (turn.assistantMessage ? 2 : 1), 0),
  };
}

function messagesFor(conversationId: string, turns: StoredTurn[]): StoredChatMessage[] {
  return turns.flatMap((turn) => {
    const userMessage: StoredChatMessage = { ...turn.userMessage, createdAt: turn.createdAt };
    if (!turn.assistantMessage) return [userMessage];
    return [
      userMessage,
      {
        ...turn.assistantMessage,
        createdAt: turn.createdAt,
        response: {
          ...turn.assistantMessage.response,
          conversationId,
        } as AssistantResponse,
      },
    ];
  });
}

export async function chatConversationExists(
  userId: UserId,
  conversationId: string,
): Promise<boolean> {
  return (await settledConversations(userId)).some(
    (conversation) => conversation.id === conversationId,
  );
}

export async function listChatConversations(
  userId: UserId,
  allowedReportIds?: ReadonlySet<string>,
): Promise<ChatConversationSummary[]> {
  return (await settledConversations(userId))
    .map((conversation) => ({
      conversation,
      turns: visibleTurns(conversation, allowedReportIds),
    }))
    .filter(({ turns }) => turns.length > 0)
    .sort((a, b) => b.conversation.updatedAt.localeCompare(a.conversation.updatedAt))
    .map(({ conversation, turns }) => summaryFor(conversation, turns));
}

export async function getChatConversation(
  userId: UserId,
  conversationId: string,
  allowedReportIds?: ReadonlySet<string>,
): Promise<{ conversation: ChatConversationSummary; messages: StoredChatMessage[] } | null> {
  const stored = (await settledConversations(userId)).find(
    (conversation) => conversation.id === conversationId,
  );
  if (!stored) return null;
  const turns = visibleTurns(stored, allowedReportIds);
  return {
    conversation: summaryFor(stored, turns),
    messages: messagesFor(stored.id, turns),
  };
}

export async function beginChatTurn(input: {
  conversationId: string;
  requestId: string;
  userId: UserId;
  question: string;
}): Promise<void> {
  await queueWrite(input.userId, async () => {
    const conversations = await readConversations(input.userId);
    if (conversations.some((conversation) => (
      conversation.turns.some((turn) => turn.requestId === input.requestId)
    ))) return;

    const existing = conversations.find(
      (conversation) => conversation.id === input.conversationId,
    );
    const now = new Date().toISOString();
    const turn = StoredTurnSchema.parse({
      requestId: input.requestId,
      userId: input.userId,
      createdAt: now,
      userMessage: {
        id: `user-${input.requestId}`,
        role: "user",
        content: input.question,
      },
    });
    const updated = StoredConversationSchema.parse({
      id: input.conversationId,
      userId: input.userId,
      title: existing?.title ?? conversationTitle(input.question),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      turns: [...(existing?.turns ?? []), turn].slice(-MAX_STORED_TURNS),
    });
    await writeConversations(
      input.userId,
      [updated, ...conversations.filter((conversation) => conversation.id !== updated.id)]
        .slice(0, MAX_STORED_CONVERSATIONS),
    );
  });
}

export async function completeChatTurn(input: {
  conversationId: string;
  requestId: string;
  userId: UserId;
  response: AssistantResponse;
}): Promise<void> {
  await queueWrite(input.userId, async () => {
    const conversations = await readConversations(input.userId);
    const existing = conversations.find(
      (conversation) => conversation.id === input.conversationId,
    );
    if (!existing) throw new Error("Cannot complete a missing chat conversation.");

    const pending = existing.turns.find((turn) => turn.requestId === input.requestId);
    if (!pending) throw new Error("Cannot complete a missing chat turn.");
    if (pending.assistantMessage) return;

    const now = new Date().toISOString();
    const updated = StoredConversationSchema.parse({
      ...existing,
      updatedAt: now,
      turns: existing.turns.map((turn) => turn.requestId === input.requestId
        ? {
            ...turn,
            assistantMessage: {
              id: `assistant-${input.requestId}`,
              role: "assistant",
              content: input.response.answer,
              response: { ...input.response, conversationId: input.conversationId },
            },
          }
        : turn),
    });
    await writeConversations(
      input.userId,
      [updated, ...conversations.filter((conversation) => conversation.id !== updated.id)],
    );
  });
}

export async function deleteChatConversation(
  userId: UserId,
  conversationId: string,
): Promise<boolean> {
  let removed = false;
  await queueWrite(userId, async () => {
    const conversations = await readConversations(userId);
    const remaining = conversations.filter((conversation) => conversation.id !== conversationId);
    removed = remaining.length !== conversations.length;
    if (removed) await writeConversations(userId, remaining);
  });
  return removed;
}

export async function clearChatHistory(userId: UserId): Promise<void> {
  await queueWrite(userId, () => writeConversations(userId, []));
}
