import { beforeEach, describe, expect, it } from "vitest";
import {
  beginChatTurn,
  clearChatHistory,
  completeChatTurn,
  getChatConversation,
  listChatConversations,
} from "@/lib/chat-history";
import type { AssistantResponse, UserId } from "@/lib/types";

const USERS: UserId[] = ["alex", "jordan", "taylor"];
const CONVERSATION_A = "b570d2b0-d510-41ce-89f6-bbe58cdb5624";
const CONVERSATION_B = "7d3e04a8-491e-4954-bcf6-d710a5d5811e";
const response: AssistantResponse = {
  conversationId: CONVERSATION_A,
  answer: "A grounded answer.",
  citations: [],
  workflow: [],
  blockedReports: [],
  noAnswer: false,
  mode: "demo",
  auditId: "AUD-TEST",
};

async function storeChatTurn(input: {
  conversationId: string;
  requestId: string;
  userId: UserId;
  question: string;
  response: AssistantResponse;
}) {
  await beginChatTurn(input);
  await completeChatTurn(input);
}

describe("stored chat conversations", () => {
  beforeEach(async () => {
    await Promise.all(USERS.map((userId) => clearChatHistory(userId)));
  });

  it("restores a complete conversation for the signed identity", async () => {
    const input = {
      conversationId: CONVERSATION_A,
      requestId: "6f63943a-c24b-4a82-aa39-6757307ca994",
      userId: "alex" as const,
      question: "What does the report say?",
      response,
    };
    await beginChatTurn(input);
    expect((await listChatConversations("alex"))[0]).toMatchObject({
      id: CONVERSATION_A,
      title: "What does the report say?",
      messageCount: 1,
    });
    await completeChatTurn(input);

    const stored = await getChatConversation("alex", CONVERSATION_A);
    expect(stored?.messages).toMatchObject([
      { role: "user", content: "What does the report say?" },
      { role: "assistant", content: "A grounded answer." },
    ]);
    expect(stored?.messages[1].response).toEqual(response);
    expect((await listChatConversations("alex"))[0]).toMatchObject({
      id: CONVERSATION_A,
      title: "What does the report say?",
      messageCount: 2,
    });
  });

  it("keeps separate threads and deduplicates request writes", async () => {
    const requestId = "078b6e26-b919-46a8-99b7-bce1d89b119c";
    await storeChatTurn({
      conversationId: CONVERSATION_A,
      requestId,
      userId: "jordan",
      question: "First topic",
      response,
    });
    await storeChatTurn({
      conversationId: CONVERSATION_A,
      requestId,
      userId: "jordan",
      question: "First topic",
      response,
    });
    await storeChatTurn({
      conversationId: CONVERSATION_B,
      requestId: "12af61b6-5bd4-42b1-bdd5-7b7f8a0cad4e",
      userId: "jordan",
      question: "Second topic",
      response: { ...response, conversationId: CONVERSATION_B },
    });

    expect(await listChatConversations("jordan")).toHaveLength(2);
    expect((await getChatConversation("jordan", CONVERSATION_A))?.messages).toHaveLength(2);
    expect(await listChatConversations("alex")).toEqual([]);
  });

  it("clears only the selected identity", async () => {
    await storeChatTurn({
      conversationId: CONVERSATION_A,
      requestId: "55fd1a52-225c-4c57-be35-269549843c38",
      userId: "alex",
      question: "Alex question",
      response,
    });
    await storeChatTurn({
      conversationId: CONVERSATION_B,
      requestId: "68e3ba6a-ec12-49df-b9ca-fe2b78ea2b83",
      userId: "taylor",
      question: "Taylor question",
      response: { ...response, conversationId: CONVERSATION_B },
    });

    await clearChatHistory("alex");
    expect(await listChatConversations("alex")).toEqual([]);
    expect(await listChatConversations("taylor")).toHaveLength(1);
  });

  it("does not restore a turn whose cited report is no longer authorized", async () => {
    await storeChatTurn({
      conversationId: CONVERSATION_A,
      requestId: "c033f639-df36-4527-930f-84c507a61c4d",
      userId: "alex",
      question: "Restricted question",
      response: {
        ...response,
        citations: [{
          id: "S1",
          documentId: "report-robotics",
          title: "Restricted report",
          code: "DEMO-ROBOTICS-02",
          section: "Market share",
          anchor: "market-share",
          sourceOffset: null,
          excerpt: "Restricted evidence",
          figures: [],
          relevance: 99,
        }],
      },
    });

    expect((await getChatConversation(
      "alex",
      CONVERSATION_A,
      new Set(["report-robotics"]),
    ))?.messages).toHaveLength(2);
    expect((await getChatConversation(
      "alex",
      CONVERSATION_A,
      new Set(),
    ))?.messages).toEqual([]);
  });
});
