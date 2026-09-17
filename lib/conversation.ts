import type { ChatHistoryMessage } from "@/lib/types";

const FOLLOW_UP_WORDS = /\b(?:it|its|that|those|them|they|this|these|calculation|calculations|calculate|calculated|difference|gap|result|figure|figures|number|numbers|though|again|also|why|how|source|sources|evidence)\b/i;
const FOLLOW_UP_OPENING = /^(?:and|but|so|okay|ok|what about|how about|did you|can you|could you|would you|show me|explain|break (?:it|that) down)\b/i;

export function isContextualFollowUp(question: string): boolean {
  const words = question.trim().split(/\s+/).filter(Boolean);
  return words.length <= 18 && (FOLLOW_UP_WORDS.test(question) || FOLLOW_UP_OPENING.test(question));
}

export function resolveResearchQuestion(
  question: string,
  history: ChatHistoryMessage[],
): string {
  if (!isContextualFollowUp(question)) return question;

  const previousUserQuestion = [...history]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.trim();

  if (!previousUserQuestion) return question;
  return `${previousUserQuestion}\nFollow-up: ${question}`;
}
