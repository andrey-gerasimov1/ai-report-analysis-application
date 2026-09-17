export type ReportId = string;

export type UserId = "alex" | "jordan" | "taylor";

export type DemoUser = {
  id: UserId;
  name: string;
  initials: string;
  role: string;
  organization: string;
  accent: string;
  reportIds: ReportId[];
};

export type ReportDefinition = {
  id: ReportId;
  code: string;
  title: string;
  shortTitle: string;
  filename: string;
  published: string;
  geography: string;
  category: string;
  size: string;
  color: "teal" | "coral";
  description: string;
  priceCents: number;
  currency: "USD";
  keywords: string[];
  allowedUsers: UserId[];
  version: string;
};

declare const authorizedReportBrand: unique symbol;
export type AuthorizedReport = ReportDefinition & {
  readonly [authorizedReportBrand]: true;
};

export type ReportAccess = Omit<ReportDefinition, "keywords" | "allowedUsers" | "version"> & {
  accessible: boolean;
  accessLabel: string;
};

export type RetrievedChunk = {
  documentId: ReportId;
  title: string;
  shortTitle: string;
  code: string;
  section: string;
  anchor: string;
  sourceOffset: number | null;
  text: string;
  score: number;
};

export type Citation = {
  id: string;
  documentId: ReportId;
  title: string;
  code: string;
  section: string;
  anchor: string;
  sourceOffset: number | null;
  excerpt: string;
  figures: string[];
  relevance: number;
};

export type WorkflowStep = {
  id: "identity" | "route" | "authorize" | "retrieve" | "ground" | "generate";
  label: string;
  detail: string;
  status: "complete" | "warning" | "blocked";
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AnswerMode = "live" | "verified" | "demo" | "policy" | "grounded";
export type ReportRoutingMode = "ai" | "metadata";

export type ReportRoutingDecision = {
  mode: ReportRoutingMode;
  reportIds: ReportId[];
  intent: string;
  confidence: number | null;
  fallbackReason?: string;
};

export type AuditReasonCode =
  | "ACCESS_GRANTED"
  | "PARTIAL_ENTITLEMENT"
  | "REPORT_NOT_LICENSED"
  | "NO_LICENSED_REPORTS"
  | "NO_RELEVANT_EVIDENCE";

export type AssistantResponse = {
  conversationId: string;
  answer: string;
  citations: Citation[];
  workflow: WorkflowStep[];
  blockedReports: Array<Pick<
    ReportDefinition,
    "id" | "title" | "code" | "priceCents" | "currency"
  > & Pick<Partial<ReportDefinition>, "shortTitle">>;
  noAnswer: boolean;
  mode: AnswerMode;
  auditId: string;
};

export type ChatStreamEvent =
  | { type: "progress"; step: WorkflowStep }
  | { type: "result"; response: AssistantResponse }
  | { type: "error"; error: string };

export type StoredChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  response?: AssistantResponse;
};

export type ChatConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type AuditEvent = {
  id: string;
  timestamp: string;
  userId: UserId;
  action: "query.completed" | "query.partial" | "query.denied" | "query.unsupported";
  question: string;
  searchedReports: ReportId[];
  blockedReports: ReportId[];
  citationCount: number;
  mode: AnswerMode;
  reasonCode: AuditReasonCode;
  routingMode?: ReportRoutingMode;
  routingConfidence?: number | null;
  routedReports?: ReportId[];
};
