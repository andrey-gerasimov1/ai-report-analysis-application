"use client";

import {
  Activity,
  AlertCircle,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Database,
  ExternalLink,
  FileLock2,
  FileText,
  KeyRound,
  Library,
  LoaderCircle,
  Lock,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Send,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Trash2,
  UserCheck,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BrandMark } from "@/components/brand-mark";
import { SUGGESTED_QUESTIONS, USERS } from "@/lib/demo-data";
import { answerFigures, figureEvidenceTargets, type EvidenceTarget } from "@/lib/figure-provenance";
import { SOURCE_FOCUS_ANCHOR } from "@/lib/report-anchors";
import type {
  AnswerMode,
  AssistantResponse,
  AuditEvent,
  ChatConversationSummary,
  ChatStreamEvent,
  Citation,
  DemoUser,
  ReportAccess,
  StoredChatMessage,
  UserId,
  WorkflowStep,
} from "@/lib/types";

type TabId = "assistant" | "library" | "audit";

type ContextPayload = {
  user: DemoUser;
  users: DemoUser[];
  reports: ReportAccess[];
  aiMode: "live" | "demo";
  auditCount: number;
  reportDirectory: string;
  sessionType: "signed-demo";
  quarantinedCount: number;
  supportedFormats: string[];
};

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: AssistantResponse;
};

type EvidenceViewerState = {
  targets: EvidenceTarget[];
  activeIndex: number;
};

type HistoryIndexPayload = {
  conversations: ChatConversationSummary[];
  activeConversationId: string | null;
  messages: StoredChatMessage[];
};

type PurchaseResult = {
  purchaseId: string | null;
  purchasedAt: string | null;
  currency: "USD";
  totalCents: number;
  purchasedReportIds: string[];
  allRequestedReportsAccessible: boolean;
};

type BlockedReport = AssistantResponse["blockedReports"][number];

type OpenEvidenceHandler = (targets: EvidenceTarget[], activeCitationId?: string) => void;

const NAV_ITEMS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "assistant", label: "Research assistant", icon: MessageSquare },
  { id: "library", label: "Research library", icon: Library },
  { id: "audit", label: "Audit trail", icon: Activity },
];

const LOADING_STEPS: Array<{
  id: WorkflowStep["id"];
  label: string;
  detail: string;
}> = [
  { id: "identity", label: "Resolving identity", detail: "Verifying the signed session" },
  { id: "route", label: "Routing report intent", detail: "AI is selecting candidate reports from safe metadata" },
  { id: "authorize", label: "Checking entitlements", detail: "Applying report-level permissions" },
  { id: "retrieve", label: "Searching licensed research", detail: "Ranking relevant report sections" },
  { id: "ground", label: "Grounding evidence", detail: "Preparing evidence and citations" },
  { id: "generate", label: "Generating answer", detail: "Writing from the verified evidence" },
];

const TECHNICAL_DETAILS_STORAGE_KEY = "report-analysis:technical-details";
const DEMO_IDENTITY_STORAGE_KEY = "report-analysis:demo-identity";

const formatReportPrice = (priceCents: number, currency: "USD") => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency,
  maximumFractionDigits: 0,
}).format(priceCents / 100);

const chatTitle = (question: string) => {
  const normalized = question.replace(/\s+/g, " ").trim();
  return normalized.length <= 52 ? normalized : `${normalized.slice(0, 51).trimEnd()}…`;
};

const blankChatSessionKey = (userId: UserId) => `report-analysis:blank-chat:${userId}`;

const shouldRestoreBlankChat = (userId: UserId): boolean => {
  try {
    return window.sessionStorage.getItem(blankChatSessionKey(userId)) === "1";
  } catch {
    return false;
  }
};

const rememberBlankChat = (userId: UserId, blank: boolean) => {
  try {
    if (blank) {
      window.sessionStorage.setItem(blankChatSessionKey(userId), "1");
    } else {
      window.sessionStorage.removeItem(blankChatSessionKey(userId));
    }
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
};

const storedTechnicalDetailsPreference = (): boolean => {
  try {
    return window.localStorage.getItem(TECHNICAL_DETAILS_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
};

const rememberTechnicalDetailsPreference = (enabled: boolean) => {
  try {
    window.localStorage.setItem(TECHNICAL_DETAILS_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // The current view still works when preference storage is unavailable.
  }
};

const storedDemoIdentity = (): UserId => {
  try {
    const stored = window.localStorage.getItem(DEMO_IDENTITY_STORAGE_KEY);
    return USERS.some((user) => user.id === stored) ? stored as UserId : "alex";
  } catch {
    return "alex";
  }
};

const rememberDemoIdentity = (userId: UserId) => {
  try {
    window.localStorage.setItem(DEMO_IDENTITY_STORAGE_KEY, userId);
  } catch {
    // The signed session cookie remains the source of truth if storage is unavailable.
  }
};

const requestJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({ error: "The server returned an invalid response." }));
  if (!response.ok) {
    const error = typeof payload === "object" && payload && "error" in payload
      ? String(payload.error)
      : "Request failed";
    throw new Error(error);
  }
  return payload as T;
};

const requestChatStream = async (
  payload: { requestId: string; question: string; conversationId?: string },
  onProgress: (step: WorkflowStep) => void,
  onConversationStarted?: (conversationId: string) => void,
): Promise<AssistantResponse> => {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "The server returned an invalid response." }));
    throw new Error(
      typeof body === "object" && body && "error" in body ? String(body.error) : "Request failed",
    );
  }
  const conversationId = response.headers.get("x-conversation-id");
  if (conversationId) onConversationStarted?.(conversationId);
  if (!response.body) throw new Error("The browser could not read the workflow stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AssistantResponse | null = null;
  let streamError: string | null = null;

  const processBlock = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;

    const event = JSON.parse(data) as ChatStreamEvent;
    if (event.type === "progress") onProgress(event.step);
    if (event.type === "result") result = event.response;
    if (event.type === "error") streamError = event.error;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      processBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) processBlock(buffer);
  if (streamError) throw new Error(streamError);
  if (!result) throw new Error("The workflow stream ended before returning an answer.");
  return result;
};

function UserAvatar({ user, small = false }: { user: DemoUser; small?: boolean }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white shadow-sm ${small ? "size-8 text-[10px]" : "size-10 text-xs"}`}
      style={{ backgroundColor: user.accent }}
      aria-hidden="true"
    >
      {user.initials}
    </span>
  );
}

function ModeBadge({ mode }: { mode: AnswerMode }) {
  const palette = mode === "live"
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : mode === "verified"
      ? "border-teal-200 bg-teal-50 text-teal-800"
      : mode === "policy"
        ? "border-orange-200 bg-orange-50 text-orange-800"
        : mode === "grounded"
          ? "border-slate-200 bg-slate-50 text-slate-700"
          : "border-amber-200 bg-amber-50 text-amber-800";
  const dot = mode === "live"
    ? "bg-emerald-500"
    : mode === "verified"
      ? "bg-teal-500"
      : mode === "policy"
        ? "bg-orange-500"
        : mode === "grounded"
          ? "bg-slate-500"
          : "bg-amber-500";
  const label = mode === "live"
    ? "OpenAI live"
    : mode === "verified"
      ? "Verified math"
      : mode === "policy"
        ? "Access policy"
        : mode === "grounded"
          ? "No-answer guard"
          : "Guided demo";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${palette}`}
    >
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function Sidebar({
  activeTab,
  setActiveTab,
  open,
  onClose,
  auditCount,
  reportCount,
  licensedReportCount,
  reportDirectory,
  quarantinedCount,
  conversations,
  activeConversationId,
  onNewChat,
  onSelectConversation,
  conversationBusy,
  technicalDetails,
}: {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  open: boolean;
  onClose: () => void;
  auditCount: number;
  reportCount: number;
  licensedReportCount: number;
  reportDirectory: string;
  quarantinedCount: number;
  conversations: ChatConversationSummary[];
  activeConversationId: string | null;
  onNewChat: () => void;
  onSelectConversation: (conversationId: string) => void;
  conversationBusy: boolean;
  technicalDetails: boolean;
}) {
  return (
    <>
      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-[#1f3540]/35 backdrop-blur-[2px] lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[244px] flex-col border-r border-[#dce7ed] bg-[#fbfdfe]/95 px-4 py-5 backdrop-blur-xl transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <BrandMark
            fullWidth
            disabled={conversationBusy}
            onClick={() => {
              onNewChat();
              onClose();
            }}
          />
          <button
            className="grid size-8 place-items-center rounded-lg text-[#687985] hover:bg-[#f2f2ff] lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </button>
        </div>

        <button
          type="button"
          disabled={conversationBusy}
          onClick={() => {
            onNewChat();
            onClose();
          }}
          className="mt-6 flex w-full items-center gap-2.5 rounded-xl border border-[#dce7ed] bg-white px-3 py-3 text-left text-[12px] font-bold text-[#405966] shadow-sm transition hover:border-[#b9bbed] hover:bg-[#f8f8ff] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="size-4 text-[#5d61b9]" />
          New chat
        </button>

        <div className="mt-6 px-2 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#9aa5a1]">
          Workspace
        </div>
        <nav className="mt-2 space-y-1" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeTab;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  onClose();
                }}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition ${
                  active
                    ? "bg-[#5d61b9] text-white shadow-sm"
                    : "text-[#687985] hover:bg-[#f2f2ff] hover:text-[#4c509c]"
                }`}
              >
                <Icon className={`size-4 ${active ? "text-[#e3f6ff]" : "text-[#8193a0]"}`} />
                <span className="flex-1">{item.label}</span>
                {item.id === "audit" && auditCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                      active ? "bg-white/14 text-white" : "bg-[#e8e9f7] text-[#575c92]"
                    }`}
                  >
                    {auditCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <section className="mt-5 flex min-h-[110px] flex-1 flex-col" aria-label="Chat history">
          <div className="flex items-center justify-between px-2">
            <span className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#9aa5a1]">
              Recent chats
            </span>
            <span className="text-[9px] font-bold text-[#81908b]">{conversations.length}</span>
          </div>
          <div className="scroll-thin mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {conversations.length === 0 ? (
              <p className="px-3 py-3 text-[9px] leading-4 text-[#929d99]">Your conversations will appear here.</p>
            ) : conversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <button
                  type="button"
                  key={conversation.id}
                  title={conversation.title}
                  disabled={conversationBusy}
                  onClick={() => {
                    onSelectConversation(conversation.id);
                    onClose();
                  }}
                  className={`group w-full rounded-xl px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    active
                      ? "bg-[#eeeeff] text-[#53578f]"
                      : "text-[#687985] hover:bg-[#f2f2ff] hover:text-[#53578f]"
                  }`}
                >
                  <span className="block truncate text-[10px] font-bold">{conversation.title}</span>
                  <span className="mt-1 flex items-center justify-between text-[8px] text-[#909b97]">
                    <span>{conversation.messageCount} messages</span>
                    <span>{new Date(conversation.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="mt-5 px-2 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#9aa5a1]">
          {technicalDetails ? "Connected source" : "Your sources"}
        </div>
        <div className="mt-3 rounded-2xl border border-[#dce7ed] bg-white p-3.5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-lg bg-[#eeefff] text-[#565ab0]">
              <Database className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-bold text-[#283330]">
                {technicalDetails ? "Secure report server" : "Research library"}
              </p>
              <p className="mt-0.5 text-[10px] text-[#82908c]">
                {technicalDetails
                  ? `${reportCount} indexed ${reportCount === 1 ? "file" : "files"}`
                  : `${licensedReportCount} available ${licensedReportCount === 1 ? "report" : "reports"}`}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-[#edf1f3] pt-3 text-[10px] font-semibold text-[#555a99]">
            <CheckCircle2 className="size-3.5" />
            {technicalDetails ? "Permission checks active" : "Licensed sources only"}
          </div>
          {technicalDetails && quarantinedCount > 0 && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[9px] font-semibold text-amber-800">
              <FileLock2 className="size-3" />
              {quarantinedCount} unregistered {quarantinedCount === 1 ? "file" : "files"} quarantined
            </div>
          )}
          {technicalDetails && (
            <p className="mt-2 truncate font-mono text-[8px] text-[#94a09c]">{reportDirectory}</p>
          )}
        </div>

        {technicalDetails && (
          <div className="mt-4 shrink-0 rounded-2xl bg-[#f0f0ff] p-4 text-[#315a6e]">
            <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.12em]">
              <ShieldCheck className="size-4" />
              Trust layer
            </div>
            <p className="mt-2 text-[11px] leading-5 text-[#56717f]">
              Authorization happens before retrieval. Locked report content never enters the AI prompt.
            </p>
          </div>
        )}
      </aside>
    </>
  );
}

function TechnicalDetailsToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      title={`${enabled ? "Hide" : "Show"} technical workflow details`}
      className={`inline-flex items-center gap-2 rounded-xl border px-2 py-2 text-[9px] font-bold transition sm:px-2.5 ${
        enabled
          ? "border-[#d5d7f5] bg-[#f0f0ff] text-[#4c509c]"
          : "border-[#dce7ed] bg-white text-[#667984] hover:border-[#d5d7f5]"
      }`}
    >
      <Sparkles className="hidden size-3.5 sm:block" />
      <span className="hidden xl:inline">Technical details</span>
      <span
        aria-hidden="true"
        className={`relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors ${enabled ? "bg-[#5d61b9]" : "bg-[#c8d2d7]"}`}
      >
        <span
          className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-[left] ${
            enabled ? "left-[14px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

function Header({
  context,
  selectedUserId,
  onSelectUser,
  onOpenMenu,
  onClearHistory,
  canClearHistory,
  clearingHistory,
  sessionBusy,
  onNewChat,
  technicalDetails,
  onToggleTechnicalDetails,
}: {
  context: ContextPayload | null;
  selectedUserId: UserId;
  onSelectUser: (userId: UserId) => void;
  onOpenMenu: () => void;
  onClearHistory: () => void;
  canClearHistory: boolean;
  clearingHistory: boolean;
  sessionBusy: boolean;
  onNewChat: () => void;
  technicalDetails: boolean;
  onToggleTechnicalDetails: () => void;
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const user = context?.user ?? USERS.find((option) => option.id === selectedUserId) ?? USERS[0];

  useEffect(() => {
    if (!userMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setUserMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [userMenuOpen]);

  return (
    <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-[#dce7ed]/90 bg-[#f8fbfd]/88 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onOpenMenu}
          className="grid size-9 place-items-center rounded-xl border border-[#dce7ed] bg-white text-[#506875] lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </button>
        <span className="mobile-header-brand">
          <BrandMark compact onClick={onNewChat} disabled={sessionBusy} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="desktop-header-title truncate text-[13px] font-bold text-[#344a57]">Report intelligence workspace</span>
            {context && technicalDetails && <ModeBadge mode={context.aiMode} />}
          </div>
          <p className="mt-0.5 hidden text-[10px] font-medium text-[#87938f] sm:block">
            {technicalDetails
              ? "Permission-aware research · Fictional demo data"
              : "Explore fictional sample reports"}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <TechnicalDetailsToggle enabled={technicalDetails} onToggle={onToggleTechnicalDetails} />
        <div ref={userMenuRef} className="relative">
        <button
          onClick={() => setUserMenuOpen((value) => !value)}
          className="flex items-center gap-2.5 rounded-xl border border-transparent px-1.5 py-1 transition hover:border-[#dce7ed] hover:bg-white sm:px-2"
          aria-haspopup="menu"
          aria-expanded={userMenuOpen}
        >
          <div className="hidden text-right sm:block">
            <div className="flex items-center justify-end gap-1.5">
              <span className="text-[11px] font-bold text-[#2e3a37]">{user.name}</span>
              <span className="rounded bg-[#ede7dd] px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-[0.1em] text-[#8b654e]">
                Signed demo
              </span>
            </div>
            <p className="mt-0.5 text-[9px] text-[#89948f]">{user.organization}</p>
          </div>
          <UserAvatar user={user} small />
          <ChevronDown className={`size-3.5 text-[#7d8985] transition ${userMenuOpen ? "rotate-180" : ""}`} />
        </button>

        {userMenuOpen && (
          <div
            className="shadow-float absolute right-0 top-[calc(100%+10px)] z-50 w-[292px] overflow-hidden rounded-2xl border border-[#dce7ed] bg-white p-2 fade-up"
            role="menu"
          >
            <div className="px-3 pb-2 pt-2">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#98a29f]">Switch demo identity</p>
              <p className="mt-1 text-[10px] leading-4 text-[#7a8783]">Switching creates a signed, HTTP-only session with a different entitlement set.</p>
            </div>
            {(context?.users ?? USERS).map((option) => (
              <button
                key={option.id}
                role="menuitem"
                disabled={sessionBusy}
                onClick={() => {
                  onSelectUser(option.id);
                  setUserMenuOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[#f4f4ff] disabled:cursor-not-allowed disabled:opacity-50 ${
                  selectedUserId === option.id ? "bg-[#eeeefe]" : ""
                }`}
              >
                <UserAvatar user={option} small />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-bold text-[#2c3734]">{option.name}</span>
                  <span className="mt-0.5 block truncate text-[9px] text-[#7f8b87]">{option.role}</span>
                </span>
                <span className="text-[9px] font-semibold text-[#6c7975]">
                  {option.reportIds.length}/{context?.reports.length ?? 0}
                </span>
                {selectedUserId === option.id && <Check className="size-3.5 text-[#5d61b9]" />}
              </button>
            ))}
            <div className="mt-2 border-t border-[#edf0ef] pt-2">
              <button
                type="button"
                role="menuitem"
                disabled={!canClearHistory || clearingHistory}
                onClick={() => {
                  onClearHistory();
                  setUserMenuOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[#875d4f] transition hover:bg-[#fbf4f1] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="size-4" />
                <span>
                  <span className="block text-[11px] font-bold">
                    {clearingHistory ? "Clearing chat…" : "Clear chat history"}
                  </span>
                  <span className="mt-0.5 block text-[9px] text-[#9a7b70]">Only for {user.name}</span>
                </span>
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </header>
  );
}

function AccessReportCard({ report, compact = false }: { report: ReportAccess; compact?: boolean }) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-white ${
        report.accessible ? "border-[#d9e7ee]" : "border-[#e5e2de] bg-[#faf9f7]"
      } ${compact ? "p-3.5" : "p-5"}`}
    >
      <div
        className={`absolute inset-y-0 left-0 w-1 ${
          report.accessible
            ? report.color === "teal"
              ? "bg-[#5d61b9]"
              : "bg-[#f1ba4f]"
            : "bg-[#c7cbc9]"
        }`}
      />
      <div className="flex items-start gap-3">
        <span
          className={`grid shrink-0 place-items-center rounded-xl ${
            compact ? "size-9" : "size-11"
          } ${
            report.accessible
              ? report.color === "teal"
                ? "bg-[#eeeeff] text-[#4c509c]"
                : "bg-[#fff5df] text-[#8b6416]"
              : "bg-[#ececea] text-[#878d8a]"
          }`}
        >
          {report.accessible ? <FileText className="size-4" /> : <FileLock2 className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#929c98]">
              {report.code} · {report.published}
            </p>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[8px] font-extrabold uppercase tracking-[0.08em] ${
                report.accessible
                  ? "bg-[#eeeeff] text-[#4c509c]"
                  : "bg-[#edece9] text-[#797d7b]"
              }`}
            >
              {report.accessible ? <Check className="size-2.5" /> : <Lock className="size-2.5" />}
              {report.accessLabel}
            </span>
          </div>
          <h3 className={`mt-2 font-bold leading-snug text-[#27332f] ${compact ? "text-[11px]" : "text-[15px]"}`}>
            {report.shortTitle}
          </h3>
          {!compact && (
            <>
              <p className="mt-2 text-[11px] leading-5 text-[#71807b]">{report.description}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-[9px] font-semibold text-[#74817d]">
                <span className="rounded-md bg-[#f0f3f2] px-2 py-1">{report.geography}</span>
                <span className="rounded-md bg-[#f0f3f2] px-2 py-1">{report.category}</span>
                <span className="rounded-md bg-[#f0f3f2] px-2 py-1">{report.size}</span>
                <span className="max-w-full truncate rounded-md bg-[#f0f3f2] px-2 py-1 font-mono">{report.filename}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AccessPanel({
  context,
  latest,
  onOpenEvidence,
  technicalDetails,
}: {
  context: ContextPayload;
  latest?: AssistantResponse;
  onOpenEvidence: OpenEvidenceHandler;
  technicalDetails: boolean;
}) {
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const licensedReports = context.reports.filter((report) => report.accessible);
  const visibleReports = technicalDetails ? context.reports : licensedReports;

  useEffect(() => {
    setSelectedCitation(latest?.citations[0] ?? null);
  }, [latest]);

  return (
    <aside className="scroll-thin hidden h-[calc(100vh-72px)] overflow-y-auto border-l border-[#dce7ed] bg-[#f9fcfd]/85 px-5 py-6 xl:block">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#929d99]">
            {technicalDetails ? "Security context" : "Research access"}
          </p>
          <h2 className="mt-1.5 text-[14px] font-bold text-[#2a3633]">
            {technicalDetails ? "Access boundary" : "Your library"}
          </h2>
        </div>
        <span className="grid size-9 place-items-center rounded-xl border border-[#d8e8ef] bg-white text-[#5d61b9] shadow-sm">
          <ShieldCheck className="size-4" />
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-[#dce7ed] bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <UserAvatar user={context.user} />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-bold text-[#293532]">{context.user.name}</p>
            <p className="mt-0.5 truncate text-[9px] text-[#83908c]">{context.user.organization}</p>
          </div>
        </div>
        {technicalDetails ? (
          <>
            <div className="mt-4 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5 text-center">
              {[
                [UserCheck, "Identity"],
                [KeyRound, "Entitle"],
                [Search, "Retrieve"],
              ].map(([Icon, label], index) => {
                const IconComponent = Icon as LucideIcon;
                return (
                  <div className="contents" key={label as string}>
                    <div className="rounded-xl bg-[#f0f0ff] px-1 py-2.5 text-[#4c509c]">
                      <IconComponent className="mx-auto size-3.5" />
                      <p className="mt-1 text-[8px] font-bold">{label as string}</p>
                    </div>
                    {index < 2 && <ArrowRight className="size-3 text-[#a7b0ad]" />}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#f6f8f7] px-2.5 py-2 text-[9px] font-semibold text-[#687772]">
              <Lock className="size-3 text-[#5d61b9]" />
              Signed session enforced at every data route
            </div>
          </>
        ) : (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-[#f0f0ff] p-3 text-[#315a6e]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#5d61b9]" />
            <div>
              <p className="text-[10px] font-bold">Licensed sources only</p>
              <p className="mt-1 text-[9px] leading-4 text-[#607681]">
                Answers use reports available to your account.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#929d99]">
          {technicalDetails ? "Report entitlements" : "Reports"}
        </p>
        <span className="text-[9px] font-bold text-[#56736c]">
          {technicalDetails
            ? `${licensedReports.length}/${context.reports.length} active`
            : `${licensedReports.length} available`}
        </span>
      </div>
      <div className="mt-3 space-y-2.5">
        {visibleReports.map((report) => (
          <AccessReportCard key={report.id} report={report} compact />
        ))}
      </div>

      {latest && (
        <div className="mt-7 fade-up">
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#929d99]">Answer evidence</p>
            <span className="text-[9px] font-bold text-[#56736c]">{latest.citations.length} passages</span>
          </div>
          {latest.citations.length ? (
            <>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {latest.citations.map((citation) => (
                  <button
                    key={citation.id}
                    onClick={() => setSelectedCitation(citation)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[9px] font-bold transition ${
                      selectedCitation?.id === citation.id
                        ? "border-[#5d61b9] bg-[#5d61b9] text-white"
                        : "border-[#dce7ed] bg-white text-[#667984] hover:border-[#b9bbed]"
                    }`}
                  >
                    {citation.id}
                  </button>
                ))}
              </div>
              {selectedCitation && (
                <div className="mt-3 rounded-2xl border border-[#dae4e0] bg-white p-4 shadow-sm fade-up">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md bg-[#eeefff] px-2 py-1 text-[8px] font-extrabold text-[#4c509c]">
                      {selectedCitation.code}
                    </span>
                    <span className="text-[8px] font-bold text-[#87938f]">{selectedCitation.relevance}% relevance</span>
                  </div>
                  <p className="mt-3 text-[11px] font-bold leading-4 text-[#2b3834]">{selectedCitation.section}</p>
                  <blockquote className="mt-3 border-l-2 border-[#d0e0da] pl-3 text-[10px] leading-[1.65] text-[#6f7c78]">
                    {selectedCitation.excerpt}
                  </blockquote>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#eef1f0] pt-3">
                    <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#9aa4a1]">
                      Verified report source
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenEvidence(
                        (latest?.citations ?? [selectedCitation]).map((citation) => ({ citation })),
                        selectedCitation.id,
                      )}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#5d61b9] px-2.5 py-1.5 text-[8px] font-bold text-white transition hover:bg-[#494da2]"
                    >
                      Open in report <ExternalLink className="size-2.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="mt-3 rounded-xl border border-[#e6ded7] bg-[#fbf7f3] p-3 text-[10px] leading-4 text-[#866a59]">
              No source text was exposed for this response.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function LoadingWorkflow({ completedSteps }: { completedSteps: WorkflowStep[] }) {
  const completedById = new Map(completedSteps.map((step) => [step.id, step]));
  const activeIndex = LOADING_STEPS.findIndex((step) => !completedById.has(step.id));

  return (
    <div className="w-full max-w-[690px] rounded-2xl border border-[#dce5e1] bg-white p-4 shadow-sm fade-up">
      <div className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#71807c]">
        <Sparkles className="size-3.5 text-[#5d61b9]" />
        Visible workflow
      </div>
      <div className="mt-3 space-y-1">
        {LOADING_STEPS.map((definition, index) => {
          const completed = completedById.get(definition.id);
          const isActive = index === activeIndex;
          const iconClass = completed?.status === "blocked"
            ? "border-[#c87359] bg-[#f5e2da] text-[#b5583d]"
            : completed?.status === "warning"
              ? "border-[#d39768] bg-[#f8eadf] text-[#aa6741]"
              : completed
                ? "border-[#5d61b9] bg-[#5d61b9] text-white"
                : isActive
                  ? "pulse-step border-[#5d61b9] bg-white text-[#5d61b9]"
                  : "border-[#d7dddb] text-[#abb3b0]";

          return (
            <div
              key={definition.id}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${isActive ? "bg-[#f0f0ff]" : ""}`}
            >
              <span className={`grid size-5 place-items-center rounded-full border ${iconClass}`}>
                {completed?.status === "blocked" ? (
                  <X className="size-3" />
                ) : completed?.status === "warning" ? (
                  <AlertCircle className="size-3" />
                ) : completed ? (
                  <Check className="size-3" />
                ) : (
                  <span className="size-1 rounded-full bg-current" />
                )}
              </span>
              <div>
                <p className={`text-[11px] font-bold ${completed || isActive ? "text-[#33433f]" : "text-[#9da6a3]"}`}>
                  {completed?.label ?? definition.label}
                </p>
                <p className="mt-0.5 text-[9px] text-[#8b9793]">
                  {completed?.detail ?? definition.detail}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowSummary({ response }: { response: AssistantResponse }) {
  return (
    <details className="mb-3 w-full max-w-[690px] overflow-hidden rounded-2xl border border-[#dce4e1] bg-white shadow-sm" open>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-[#eeefff] text-[#5d61b9]">
            <ShieldCheck className="size-3.5" />
          </span>
          <div>
            <p className="text-[10px] font-bold text-[#34433f]">AI-routed, permission-first workflow complete</p>
            <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[#929d99]">Audit ID {response.auditId}</p>
          </div>
        </div>
        <ChevronDown className="size-3.5 text-[#89948f]" />
      </summary>
      <div className="border-t border-[#edf0ef] px-4 py-3">
        {response.workflow.map((step, index) => (
          <div key={step.id} className="relative flex gap-3 pb-3 last:pb-0">
            {index < response.workflow.length - 1 && <span className="absolute left-[9px] top-5 h-[calc(100%-8px)] w-px bg-[#dce4e1]" />}
            <span
              className={`relative z-10 mt-0.5 grid size-[19px] shrink-0 place-items-center rounded-full ${
                step.status === "complete"
                  ? "bg-[#5d61b9] text-white"
                  : step.status === "warning"
                    ? "bg-[#f0dfd4] text-[#a45f43]"
                    : "bg-[#f1ded7] text-[#a54d37]"
              }`}
            >
              {step.status === "complete" ? <Check className="size-2.5" /> : step.status === "warning" ? <AlertCircle className="size-2.5" /> : <X className="size-2.5" />}
            </span>
            <div>
              <p className="text-[10px] font-bold text-[#44514e]">{step.label}</p>
              <p className="mt-0.5 text-[9px] text-[#8a9591]">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function AnswerText({
  text,
  citations,
  onOpenEvidence,
}: {
  text: string;
  citations: Citation[];
  onOpenEvidence: OpenEvidenceHandler;
}) {
  const citationsById = new Map(citations.map((citation) => [citation.id, citation]));
  const renderLine = (line: string) => {
    const parts = line.split(/(\[S\d+\])/g);
    return parts.flatMap((part, index) => {
      const id = part.match(/^\[(S\d+)\]$/)?.[1];
      const citation = id ? citationsById.get(id) : undefined;
      if (citation) {
        return (
          <button
            type="button"
            key={`${id}-${index}`}
            onClick={() => onOpenEvidence(citations.map((item) => ({ citation: item })), citation.id)}
            title={`Open ${citation.code} at ${citation.section}`}
            className="mx-0.5 inline-flex translate-y-[-1px] rounded bg-[#eeeefe] px-1.5 py-0.5 text-[9px] font-extrabold text-[#4c509c] transition hover:bg-[#dbddff] focus:outline-none focus:ring-2 focus:ring-[#8b91d7]"
          >
            {id}
          </button>
        );
      }
      return part.split(
        /((?:[$€£¥]\s*\d[\d,.]*(?:\s*(?:million|billion|trillion))?|\b\d[\d,.]*\s*(?:%|percentage(?:-|\s+)points?|million|billion|trillion|CAGR)?))/gi,
      ).map((textPart, figureIndex) => {
        const targets = answerFigures(textPart).length === 1
          && answerFigures(textPart)[0] === textPart
          ? figureEvidenceTargets(textPart, line, citations)
          : [];
        if (!targets.length) return <span key={`${index}-${figureIndex}`}>{textPart}</span>;
        return (
          <button
            type="button"
            key={`${index}-${figureIndex}`}
            onClick={() => onOpenEvidence(targets)}
            title={targets.length > 1
              ? `Inspect ${targets.length} source values used for ${textPart}`
              : `Find ${textPart} in the source report`}
            className="mx-0.5 inline rounded-sm border-b border-dashed border-[#4b50a8] bg-[#f3f3ff] px-0.5 font-semibold text-[#53578f] transition hover:bg-[#e4e5ff] focus:outline-none focus:ring-2 focus:ring-[#8b91d7]"
          >
            {textPart}
          </button>
        );
      });
    });
  };

  return (
    <div className="space-y-2.5 text-[13px] leading-[1.72] text-[#3f4b48]">
      {text.split("\n").map((line, index) => {
        if (!line.trim()) return <div key={index} className="h-1" />;
        const isBullet = /^[•*-]\s/.test(line);
        return isBullet ? (
          <div key={index} className="flex gap-2.5">
            <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-[#5d61b9]" />
            <p>{renderLine(line.replace(/^[•*-]\s/, ""))}</p>
          </div>
        ) : (
          <p key={index}>{renderLine(line)}</p>
        );
      })}
    </div>
  );
}

function PurchaseOffer({
  reports,
  accessibleReportIds,
  organization,
  originalQuestion,
  disabled,
  onAccessChanged,
  onRetry,
}: {
  reports: BlockedReport[];
  accessibleReportIds: ReadonlySet<string>;
  organization: string;
  originalQuestion: string;
  disabled: boolean;
  onAccessChanged: () => Promise<void>;
  onRetry: (question: string) => void;
}) {
  const remainingReports = reports.filter((report) => !accessibleReportIds.has(report.id));
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutReports, setCheckoutReports] = useState<BlockedReport[]>([]);
  const [stage, setStage] = useState<"checkout" | "processing" | "success">("checkout");
  const [purchaseResult, setPurchaseResult] = useState<PurchaseResult | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState(false);

  const totalCents = checkoutReports.reduce((sum, report) => sum + report.priceCents, 0);
  const displayedCurrency = checkoutReports[0]?.currency ?? "USD";

  const openCheckout = () => {
    if (!remainingReports.length || disabled) return;
    setCheckoutReports(remainingReports);
    setStage("checkout");
    setPurchaseResult(null);
    setPurchaseError(null);
    setRefreshWarning(false);
    setCheckoutOpen(true);
  };

  const closeCheckout = useCallback(() => {
    if (stage === "processing") return;
    setCheckoutOpen(false);
  }, [stage]);

  useEffect(() => {
    if (!checkoutOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCheckout();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [checkoutOpen, closeCheckout]);

  const completePurchase = async () => {
    if (!checkoutReports.length || stage === "processing") return;
    setStage("processing");
    setPurchaseError(null);
    setRefreshWarning(false);

    try {
      const [result] = await Promise.all([
        requestJson<PurchaseResult>("/api/purchases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportIds: checkoutReports.map((report) => report.id) }),
        }),
        new Promise((resolve) => window.setTimeout(resolve, 900)),
      ]);
      setPurchaseResult(result);
      setStage("success");
      try {
        await onAccessChanged();
      } catch {
        setRefreshWarning(true);
      }
    } catch (caught) {
      setStage("checkout");
      setPurchaseError(caught instanceof Error ? caught.message : "The simulated purchase could not be completed.");
    }
  };

  const retryOriginalQuestion = () => {
    if (!originalQuestion || disabled) return;
    setCheckoutOpen(false);
    onRetry(originalQuestion);
  };

  const purchaseModal = checkoutOpen ? createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-[#153b4d]/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeCheckout();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-checkout-title"
        className="max-h-[calc(100vh-2rem)] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-[#d8e5eb] bg-white shadow-[0_24px_80px_rgba(18,55,72,0.28)]"
      >
        <div className="flex items-start justify-between border-b border-[#e7eef1] px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-[#eeefff] text-[#4c509c]">
              <ShoppingCart className="size-4" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="demo-checkout-title" className="text-[15px] font-bold text-[#213c49]">
                  {stage === "success" ? "Purchase complete" : "Purchase report access"}
                </h2>
                <span className="rounded-full border border-[#f2c997] bg-[#fff8ed] px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[0.12em] text-[#a85b12]">
                  Simulated
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-[#73848b]">Demo checkout · no real payment is collected</p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeCheckout}
            disabled={stage === "processing"}
            aria-label="Close checkout"
            className="grid size-8 place-items-center rounded-lg border border-[#dce6ea] text-[#6e7f85] transition hover:bg-[#f2f7f9] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </div>

        {stage === "success" ? (
          <div className="px-5 py-6 sm:px-6">
            <span className="grid size-12 place-items-center rounded-full bg-[#e5f6ef] text-[#288260]">
              <CheckCircle2 className="size-6" />
            </span>
            <h3 className="mt-4 text-[17px] font-bold text-[#213c49]">The reports are now in your library.</h3>
            <p className="mt-2 text-[12px] leading-5 text-[#64757b]">
              Access was added to this signed demo account and is now enforced by the same server permission checks used by search and the report viewer.
            </p>
            {purchaseResult?.purchaseId ? (
              <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.08em] text-[#8a989d]">
                Demo receipt {purchaseResult.purchaseId.slice(0, 8)}
              </p>
            ) : null}
            {refreshWarning ? (
              <div className="mt-4 rounded-xl border border-[#efd7b7] bg-[#fff9ef] p-3 text-[10px] leading-4 text-[#8b622d]">
                Purchase completed, but the library display could not refresh. Retrying will still use the new server entitlement.
              </div>
            ) : null}
            {purchaseResult?.allRequestedReportsAccessible && originalQuestion ? (
              <div className="mt-5 rounded-xl border border-[#cce7f3] bg-[#f1f9fc] p-4">
                <p className="text-[11px] font-bold text-[#25566c]">Retry your original question?</p>
                <p className="mt-1.5 line-clamp-3 text-[11px] leading-5 text-[#57737f]">“{originalQuestion}”</p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeCheckout}
                    className="rounded-lg border border-[#cedde3] bg-white px-3.5 py-2 text-[10px] font-bold text-[#62757d] transition hover:bg-[#f7fafb]"
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    onClick={retryOriginalQuestion}
                    disabled={disabled}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#4c509c] px-3.5 py-2 text-[10px] font-bold text-white transition hover:bg-[#414582] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Retry original question <ArrowRight className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={closeCheckout} className="rounded-lg bg-[#4c509c] px-4 py-2 text-[10px] font-bold text-white transition hover:bg-[#414582]">
                  Done
                </button>
              </div>
            )}
          </div>
        ) : (
          <form
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void completePurchase();
            }}
          >
            <div className="space-y-5 px-5 py-5 sm:px-6">
              <div className="rounded-xl border border-[#dce8ed] bg-[#f8fbfc] p-4">
                <p className="text-[9px] font-extrabold uppercase tracking-[0.13em] text-[#7c8d93]">Order summary</p>
                <div className="mt-3 space-y-3">
                  {checkoutReports.map((report) => (
                    <div key={report.id} className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#7b8b91]">{report.code}</p>
                        <p className="mt-0.5 text-[12px] font-semibold text-[#263f4a]">{report.shortTitle ?? report.title}</p>
                      </div>
                      <p className="shrink-0 text-[12px] font-bold text-[#263f4a]">{formatReportPrice(report.priceCents, report.currency)}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-[#dce8ed] pt-3">
                  <span className="text-[11px] font-bold text-[#566b74]">Total</span>
                  <span className="text-[15px] font-bold text-[#4c509c]">{formatReportPrice(totalCents, displayedCurrency)}</span>
                </div>
              </div>

              <div className="rounded-xl border border-[#bfe2f1] bg-[#f0f9fd] p-3 text-[10px] leading-4 text-[#3c7188]">
                The details below are fake demo data. They stay in this browser and are never sent to the server.
              </div>

              <fieldset disabled={stage === "processing"} className="space-y-3">
                <legend className="mb-3 flex items-center gap-2 text-[11px] font-bold text-[#344b55]">
                  <CreditCard className="size-4 text-[#5d61b9]" /> Demo billing details
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#7a898e]">
                    Name on card
                    <input defaultValue="Alex Morgan" className="w-full rounded-lg border border-[#d6e2e7] bg-white px-3 py-2.5 text-[11px] font-normal normal-case tracking-normal text-[#344b55] outline-none focus:border-[#8b91d7] focus:ring-2 focus:ring-[#eeedff]" />
                  </label>
                  <label className="space-y-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#7a898e]">
                    Organization
                    <input defaultValue={organization} className="w-full rounded-lg border border-[#d6e2e7] bg-white px-3 py-2.5 text-[11px] font-normal normal-case tracking-normal text-[#344b55] outline-none focus:border-[#8b91d7] focus:ring-2 focus:ring-[#eeedff]" />
                  </label>
                </div>
                <label className="block space-y-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#7a898e]">
                  Email
                  <input type="email" defaultValue="alex.morgan@example.com" className="w-full rounded-lg border border-[#d6e2e7] bg-white px-3 py-2.5 text-[11px] font-normal normal-case tracking-normal text-[#344b55] outline-none focus:border-[#8b91d7] focus:ring-2 focus:ring-[#eeedff]" />
                </label>
                <label className="block space-y-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#7a898e]">
                  Card number
                  <input inputMode="numeric" defaultValue="4242 4242 4242 4242" className="w-full rounded-lg border border-[#d6e2e7] bg-white px-3 py-2.5 font-mono text-[11px] font-normal normal-case tracking-normal text-[#344b55] outline-none focus:border-[#8b91d7] focus:ring-2 focus:ring-[#eeedff]" />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#7a898e]">
                    Expiry
                    <input defaultValue="12/30" className="w-full rounded-lg border border-[#d6e2e7] bg-white px-3 py-2.5 text-[11px] font-normal normal-case tracking-normal text-[#344b55] outline-none focus:border-[#8b91d7] focus:ring-2 focus:ring-[#eeedff]" />
                  </label>
                  <label className="space-y-1.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#7a898e]">
                    CVC
                    <input inputMode="numeric" defaultValue="123" className="w-full rounded-lg border border-[#d6e2e7] bg-white px-3 py-2.5 text-[11px] font-normal normal-case tracking-normal text-[#344b55] outline-none focus:border-[#8b91d7] focus:ring-2 focus:ring-[#eeedff]" />
                  </label>
                </div>
              </fieldset>

              {purchaseError ? (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[10px] leading-4 text-red-700">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {purchaseError}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e7eef1] bg-[#fbfcfc] px-5 py-4 sm:px-6">
              <p className="text-[9px] text-[#849298]">No card is charged in this prototype.</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeCheckout}
                  disabled={stage === "processing"}
                  className="rounded-lg border border-[#d5e1e5] bg-white px-3.5 py-2 text-[10px] font-bold text-[#62757d] transition hover:bg-[#f5f8f9] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={stage === "processing"}
                  className="inline-flex min-w-[176px] items-center justify-center gap-2 rounded-lg bg-[#4c509c] px-4 py-2 text-[10px] font-bold text-white transition hover:bg-[#414582] disabled:cursor-wait disabled:bg-[#aaaee0]"
                >
                  {stage === "processing" ? (
                    <><LoaderCircle className="size-3.5 animate-spin" /> Processing demo purchase…</>
                  ) : (
                    <>Complete purchase · {formatReportPrice(totalCents, displayedCurrency)}</>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <div className={`mt-4 rounded-xl border p-4 ${remainingReports.length ? "border-[#cce5f0] bg-[#f4fafc]" : "border-[#cce8dc] bg-[#f2faf6]"}`}>
        {remainingReports.length ? (
          <>
            <div className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#eeedff] text-[#4c509c]">
                <ShoppingCart className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold text-[#294955]">Add the missing {remainingReports.length === 1 ? "report" : "reports"} to your library</p>
                <div className="mt-2 space-y-2">
                  {remainingReports.map((report) => (
                    <div key={report.id} className="flex items-start justify-between gap-3 text-[10px] leading-4">
                      <span className="min-w-0 text-[#61777f]"><strong className="text-[#3e5963]">{report.code}</strong> · {report.shortTitle ?? report.title}</span>
                      <span className="shrink-0 font-bold text-[#2e596a]">{formatReportPrice(report.priceCents, report.currency)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#deedf3] pt-3">
              <p className="text-[9px] text-[#7a8d94]">Simulated purchase for this demo account</p>
              <button
                type="button"
                onClick={openCheckout}
                disabled={disabled}
                className="inline-flex items-center gap-2 rounded-lg bg-[#4c509c] px-3.5 py-2 text-[10px] font-bold text-white transition hover:bg-[#414582] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Buy {remainingReports.length === 1 ? "report" : `${remainingReports.length} reports`} · {formatReportPrice(
                  remainingReports.reduce((sum, report) => sum + report.priceCents, 0),
                  remainingReports[0]?.currency ?? "USD",
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="size-4 text-[#27815f]" />
              <div>
                <p className="text-[11px] font-bold text-[#356453]">Report access purchased</p>
                <p className="mt-0.5 text-[9px] text-[#70887f]">All reports required by this request are now available.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={retryOriginalQuestion}
              disabled={disabled || !originalQuestion}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#9dd5bd] bg-white px-3 py-2 text-[10px] font-bold text-[#27785a] transition hover:bg-[#e8f7ef] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Retry question <ArrowRight className="size-3" />
            </button>
          </div>
        )}
      </div>
      {purchaseModal}
    </>
  );
}

function Conversation({
  messages,
  loading,
  loadingSteps,
  onOpenEvidence,
  technicalDetails,
  accessibleReportIds,
  organization,
  onAccessChanged,
  onRetry,
}: {
  messages: ConversationMessage[];
  loading: boolean;
  loadingSteps: WorkflowStep[];
  onOpenEvidence: OpenEvidenceHandler;
  technicalDetails: boolean;
  accessibleReportIds: ReadonlySet<string>;
  organization: string;
  onAccessChanged: () => Promise<void>;
  onRetry: (question: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[860px] space-y-7 px-4 pb-7 pt-7 sm:px-7">
      {messages.map((message, messageIndex) =>
        message.role === "user" ? (
          <div key={message.id} className="flex justify-end fade-up">
            <div className="max-w-[78%] rounded-2xl rounded-br-md bg-[#4c509c] px-4 py-3 text-[13px] leading-5 text-white shadow-sm">
              {message.content}
            </div>
          </div>
        ) : (
          <div key={message.id} className="fade-up">
            {message.response && (
              <WorkflowSummary response={message.response} />
            )}
            <div
              className={`max-w-[760px] overflow-hidden rounded-2xl border bg-white shadow-soft ${
                message.response?.noAnswer ? "border-[#eadbd3]" : "border-[#dce7ed]"
              }`}
            >
              <div className="flex items-center justify-between border-b border-[#edf0ef] px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className={`grid size-7 place-items-center rounded-lg ${message.response?.noAnswer ? "bg-[#f7e9e3] text-[#aa5d40]" : "bg-[#eeefff] text-[#4c509c]"}`}>
                    {message.response?.noAnswer ? <AlertCircle className="size-3.5" /> : <Bot className="size-3.5" />}
                  </span>
                  <div>
                    <p className="text-[10px] font-bold text-[#34413e]">
                      {!technicalDetails
                        ? message.response?.mode === "policy"
                          ? "Access notice"
                          : message.response?.mode === "verified"
                            ? "Verified answer"
                            : "Research answer"
                        : message.response?.mode === "policy"
                          ? "Server authorization decision"
                          : message.response?.mode === "grounded"
                            ? "Grounded no-answer response"
                            : message.response?.mode === "verified"
                              ? "Server-verified calculation"
                              : "AI-generated interpretation"}
                    </p>
                    <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-[#98a19f]">
                      {!technicalDetails
                        ? message.response?.mode === "policy"
                          ? "This report is not in your library"
                          : message.response?.citations.length
                            ? "Based on cited report evidence"
                            : "No report evidence found"
                        : message.response?.mode === "policy"
                          ? "Enforced before report retrieval"
                          : message.response?.mode === "grounded"
                            ? "Evidence threshold enforced server-side"
                            : "Separate from verified report evidence"}
                    </p>
                  </div>
                </div>
                {message.response && technicalDetails && <ModeBadge mode={message.response.mode} />}
              </div>
              <div className="p-5 sm:p-6">
                <AnswerText
                  text={message.content}
                  citations={message.response?.citations ?? []}
                  onOpenEvidence={onOpenEvidence}
                />
                {message.response?.blockedReports.length ? (
                  <>
                    <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-[#eadfd8] bg-[#fbf7f4] p-3 text-[10px] leading-4 text-[#815f50]">
                      <FileLock2 className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        Excluded by entitlements: {message.response.blockedReports.map((report) => report.code).join(", ")}. Its content was not read or sent to the model.
                      </span>
                    </div>
                    <PurchaseOffer
                      reports={message.response.blockedReports}
                      accessibleReportIds={accessibleReportIds}
                      organization={organization}
                      originalQuestion={messages
                        .slice(0, messageIndex)
                        .reverse()
                        .find((candidate) => candidate.role === "user")?.content ?? ""}
                      disabled={loading}
                      onAccessChanged={onAccessChanged}
                      onRetry={onRetry}
                    />
                  </>
                ) : null}
                {message.response?.citations.length ? (
                  <div className="mt-5 border-t border-[#edf0ef] pt-4">
                    <p className="text-[8px] font-extrabold uppercase tracking-[0.15em] text-[#929d99]">Evidence used</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {message.response.citations.map((citation) => (
                        <button
                          type="button"
                          key={citation.id}
                          onClick={() => onOpenEvidence(
                            message.response?.citations.map((item) => ({ citation: item })) ?? [{ citation }],
                            citation.id,
                          )}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#dce7ed] bg-[#f9fcfd] px-2.5 py-1.5 text-left text-[9px] font-semibold text-[#5d707b] transition hover:border-[#b9bbed] hover:bg-[#f2f2ff] focus:outline-none focus:ring-2 focus:ring-[#8b91d7]"
                        >
                          <FileText className="size-3 text-[#5d61b9]" />
                          {citation.id} · {citation.code} · {citation.section}
                          <ExternalLink className="size-2.5 text-[#78918a]" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ),
      )}
      {loading && (
        <LoadingWorkflow completedSteps={loadingSteps} />
      )}
    </div>
  );
}

function ReportViewer({
  viewer,
  onSelect,
  onClose,
}: {
  viewer: EvidenceViewerState;
  onSelect: (index: number) => void;
  onClose: () => void;
}) {
  const target = viewer.targets[viewer.activeIndex] ?? viewer.targets[0];
  const { citation, focusText } = target;
  const targetKey = `${citation.id}:${focusText ?? "section"}:${citation.sourceOffset ?? "full"}`;
  const [fullTargetKey, setFullTargetKey] = useState<string | null>(null);
  const canUseFocusedView = Number.isSafeInteger(citation.sourceOffset) && citation.sourceOffset !== null;
  const isFocusedView = canUseFocusedView && fullTargetKey !== targetKey;
  const sourceParams = new URLSearchParams();
  if (focusText) sourceParams.set("focus", focusText);
  if (citation.anchor) sourceParams.set("anchor", citation.anchor);
  if (isFocusedView) {
    sourceParams.set("scope", "focused");
    sourceParams.set("offset", String(citation.sourceOffset));
  } else {
    sourceParams.set("scope", "full");
  }
  const hash = isFocusedView || focusText ? SOURCE_FOCUS_ANCHOR : citation.anchor;
  const sourceUrl = `/api/reports/${encodeURIComponent(citation.documentId)}/view?${sourceParams.toString()}${hash ? `#${encodeURIComponent(hash)}` : ""}`;
  const [isDocked, setIsDocked] = useState(false);
  const canGoPrevious = viewer.activeIndex > 0;
  const canGoNext = viewer.activeIndex < viewer.targets.length - 1;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1280px)");
    const updateLayout = () => setIsDocked(mediaQuery.matches);
    updateLayout();
    mediaQuery.addEventListener("change", updateLayout);
    return () => mediaQuery.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (!isDocked) document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      const eventTarget = event.target as HTMLElement | null;
      const isEditing = eventTarget?.matches("input, textarea, [contenteditable='true']") ?? false;
      if (!isEditing && event.key === "ArrowLeft" && canGoPrevious) onSelect(viewer.activeIndex - 1);
      if (!isEditing && event.key === "ArrowRight" && canGoNext) onSelect(viewer.activeIndex + 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canGoNext, canGoPrevious, isDocked, onClose, onSelect, viewer.activeIndex]);

  return (
    <div
      className="source-viewer-shell fixed inset-0 z-[80] flex items-center justify-center bg-[#183746]/70 p-2 backdrop-blur-sm sm:p-5"
      data-layout={isDocked ? "docked" : "modal"}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal={!isDocked}
        aria-labelledby="source-viewer-title"
        className="source-viewer-panel flex h-[96vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-2xl border border-white/30 bg-white shadow-2xl sm:h-[92vh]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#dce7ed] bg-[#f9fcfd] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-[#eeefff] px-2 py-1 text-[8px] font-extrabold text-[#4c509c]">
                {citation.code}
              </span>
              <span className="inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-[0.12em] text-[#56798a]">
                <ShieldCheck className="size-3" /> Authorized source
              </span>
              {focusText && (
                <span className="max-w-[150px] truncate rounded-md bg-[#fff0b9] px-2 py-1 text-[8px] font-extrabold text-[#785d18]">
                  Exact match · {focusText}
                </span>
              )}
            </div>
            <h2 id="source-viewer-title" className="mt-1.5 truncate text-[12px] font-bold text-[#263631] sm:text-[14px]">
              {citation.section}
            </h2>
            <p className="mt-0.5 truncate text-[9px] text-[#87938f]">{citation.title}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canUseFocusedView && (
              <button
                type="button"
                onClick={() => setFullTargetKey(isFocusedView ? targetKey : null)}
                className="rounded-lg border border-[#d6e5ec] bg-white px-2 py-2 text-[9px] font-bold text-[#546c78] transition hover:border-[#b9bbed] sm:px-3"
              >
                {isFocusedView ? "Full report" : "Focused view"}
              </button>
            )}
            {viewer.targets.length > 1 && (
              <div className="flex items-center rounded-lg border border-[#d6e5ec] bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => onSelect(viewer.activeIndex - 1)}
                  disabled={!canGoPrevious}
                  aria-label="Previous evidence source"
                  className="grid size-7 place-items-center rounded-md text-[#546c78] transition hover:bg-[#f2f2ff] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="min-w-10 text-center text-[8px] font-bold tabular-nums text-[#65746f]">
                  {viewer.activeIndex + 1}/{viewer.targets.length}
                </span>
                <button
                  type="button"
                  onClick={() => onSelect(viewer.activeIndex + 1)}
                  disabled={!canGoNext}
                  aria-label="Next evidence source"
                  className="grid size-7 place-items-center rounded-md text-[#546c78] transition hover:bg-[#f2f2ff] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            )}
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-lg border border-[#d6e5ec] bg-white px-3 py-2 text-[9px] font-bold text-[#546c78] transition hover:border-[#b9bbed] sm:inline-flex"
            >
              New tab <ExternalLink className="size-3" />
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close source report"
              className="grid size-9 place-items-center rounded-lg border border-[#d6e5ec] bg-white text-[#596f7a] transition hover:border-[#b9bbed] hover:bg-[#f2f2ff]"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>
        <div className="flex items-center gap-2 border-b border-[#f2e4bd] bg-[#fff8e9] px-4 py-2 text-[9px] font-semibold text-[#80631e] sm:px-5">
          <Search className="size-3 text-[#a4771c]" />
          {focusText
            ? `${isFocusedView ? "Fast source view" : "Full report"} · Showing the exact value “${focusText}”. Use the arrows to inspect supporting inputs.`
            : isFocusedView
              ? "Fast source view · Showing the relevant report section. Open the full report whenever you need it."
              : "The highlighted location is where this citation was sourced in the full report."}
        </div>
        <iframe
          key={sourceUrl}
          src={sourceUrl}
          title={`${citation.code}: ${citation.section}`}
          sandbox=""
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 bg-white"
        />
      </section>
    </div>
  );
}

function Welcome({
  context,
  onAsk,
  technicalDetails,
}: {
  context: ContextPayload;
  onAsk: (question: string) => void;
  technicalDetails: boolean;
}) {
  const availableIds = new Set(context.user.reportIds);
  const visibleSuggestions = technicalDetails
    ? SUGGESTED_QUESTIONS
    : SUGGESTED_QUESTIONS.filter(
        (suggestion) => !suggestion.reportId || availableIds.has(suggestion.reportId),
      );

  return (
    <div className="subtle-grid flex min-h-full min-w-0 items-center justify-center overflow-x-hidden px-4 py-10 sm:px-8">
      <div className="w-full max-w-[850px] fade-up">
        <div className="mx-auto max-w-[680px] text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#d9daf5] bg-white/80 px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#4c509c] shadow-sm backdrop-blur">
            <Sparkles className="size-3" />
            {technicalDetails ? "Permission-first intelligence" : "Fictional report demo"}
          </span>
          <h1 className="editorial-heading mt-5 text-[34px] font-medium leading-[1.04] text-[#344a57] sm:text-[52px]">
            Ask your research.
            <br />
            <span className="text-[#5d61b9]">Trust the trail.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-[570px] px-1 text-[12px] leading-6 text-[#687772] sm:text-[13px]">
            {technicalDetails
              ? "Get concise answers across the reports your account is licensed to use—with visible permissions, evidence, and source-level citations."
              : "Ask questions across the reports available to your account, with clear citations for the facts that matter."}
          </p>
          <p className="mt-2 text-[10px] font-semibold text-[#73779a]">All bundled reports and market figures are invented for this demo.</p>
        </div>

        <div className={`mt-9 grid gap-3 ${
          technicalDetails
            ? "md:grid-cols-3"
            : "md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]"
        }`}>
          {visibleSuggestions.map((suggestion, index) => {
            const accessible = !suggestion.reportId || availableIds.has(suggestion.reportId);
            const icons = [TrendingUp, Zap, BookOpen];
            const Icon = icons[index];
            return (
              <button
                key={suggestion.label}
                onClick={() => onAsk(suggestion.question)}
                className="group relative w-full min-w-0 overflow-hidden rounded-2xl border border-[#dce7ed] bg-white p-4 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-[#b9bbed] hover:shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <span className={`grid size-9 place-items-center rounded-xl ${index === 1 ? "bg-[#fff5df] text-[#9a6c10]" : "bg-[#eeefff] text-[#4c509c]"}`}>
                    <Icon className="size-4" />
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[8px] font-bold ${accessible ? "bg-[#f0f0ff] text-[#4c509c]" : "bg-[#f1eeea] text-[#8a8179]"}`}>
                    {accessible ? <Check className="size-2.5" /> : <Lock className="size-2.5" />}
                    {accessible ? "Available" : "Tests access"}
                  </span>
                </div>
                <p className="mt-4 text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#8c9894]">{suggestion.label}</p>
                <p className="welcome-question mt-2 pr-2 text-[11px] font-semibold leading-[1.55] text-[#44514d]">{suggestion.question}</p>
                <ArrowRight className="absolute bottom-4 right-4 size-3.5 translate-x-1 text-[#91a09b] opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[9px] font-semibold text-[#7d8985]">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3 text-[#5d61b9]" />Authorize before retrieval</span>
          <span className="inline-flex items-center gap-1.5"><FileText className="size-3 text-[#5d61b9]" />Citations for material claims</span>
          <span className="inline-flex items-center gap-1.5"><AlertCircle className="size-3 text-[#a4771c]" />No evidence, no invented answer</span>
        </div>
      </div>
    </div>
  );
}

function Composer({
  value,
  setValue,
  onSubmit,
  disabled,
  mode,
}: {
  value: string;
  setValue: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  mode: "live" | "demo";
}) {
  return (
    <div className="border-t border-[#dce7ed] bg-[#f8fbfd]/95 px-4 py-3 backdrop-blur-xl sm:px-7">
      <div className="mx-auto max-w-[860px]">
        <div className="shadow-soft flex items-end gap-2 rounded-2xl border border-[#d7e4eb] bg-white p-2 transition focus-within:border-[#8b91d7] focus-within:ring-4 focus-within:ring-[#dff3fc]/70">
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            rows={1}
            maxLength={700}
            placeholder="Ask across your licensed research…"
            className="scroll-thin max-h-32 min-h-11 flex-1 resize-none bg-transparent px-3 py-3 text-[13px] leading-5 text-[#2f3c38] outline-none placeholder:text-[#9ba6a2]"
            aria-label="Research question"
            disabled={disabled}
          />
          <button
            onClick={onSubmit}
            disabled={disabled || value.trim().length < 3}
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#5d61b9] text-white shadow-sm transition hover:bg-[#494da2] disabled:cursor-not-allowed disabled:bg-[#bdc9cf]"
            aria-label="Ask research assistant"
          >
            <Send className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[8px] font-medium text-[#939d9a]">
          <span>{mode === "live" ? "Grounded with OpenAI · " : "Demo synthesis · "}Shift + Enter for a new line</span>
          <span>{value.length}/700</span>
        </div>
      </div>
    </div>
  );
}

function LibraryView({
  context,
  technicalDetails,
}: {
  context: ContextPayload;
  technicalDetails: boolean;
}) {
  const licensedReports = context.reports.filter((report) => report.accessible);
  const active = licensedReports.length;
  const visibleReports = technicalDetails ? context.reports : licensedReports;
  return (
    <main className="scroll-thin h-[calc(100vh-72px)] overflow-y-auto px-4 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1030px] fade-up">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#72827d]">Licensed content</p>
            <h1 className="editorial-heading mt-2 text-[38px] text-[#344a57]">Research library</h1>
            <p className="mt-3 max-w-[590px] text-[12px] leading-5 text-[#6e7b77]">
              {technicalDetails
                ? "This view reflects the same entitlement data enforced by the chat API. A locked card is not searchable, even if its identifier is submitted manually."
                : "Browse the reports available to your account."}
            </p>
          </div>
          <div className="rounded-2xl border border-[#d9e2de] bg-white px-5 py-3 text-right shadow-sm">
            <p className="text-[24px] font-bold tracking-[-0.04em] text-[#5d61b9]">
              {active}
              {technicalDetails && <span className="text-[13px] text-[#9aa5a1]">/{context.reports.length}</span>}
            </p>
            <p className="text-[8px] font-bold uppercase tracking-[0.13em] text-[#87938f]">
              {technicalDetails ? "Reports licensed" : "Reports available"}
            </p>
          </div>
        </div>

        {technicalDetails && (
          <div className="mt-7 flex flex-col gap-4 rounded-2xl border border-[#d9daf5] bg-[#f2f2ff] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[#5d61b9] shadow-sm">
              <Database className="size-4" />
            </span>
            <div>
              <p className="text-[11px] font-bold text-[#304b45]">Drop-in report directory</p>
              <p className="mt-1 text-[9px] text-[#6d817b]">Add or remove a supported file, then restart the dev server to refresh the library.</p>
            </div>
          </div>
          <div className="sm:text-right">
            <code className="rounded-md bg-white px-2.5 py-1.5 text-[9px] font-bold text-[#3e655d] shadow-sm">{context.reportDirectory}</code>
            <p className="mt-2 text-[8px] font-bold uppercase tracking-[0.12em] text-[#78908a]">{context.supportedFormats.join(" · ")}</p>
          </div>
          </div>
        )}

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {visibleReports.map((report) => <AccessReportCard key={report.id} report={report} />)}
        </div>

        {technicalDetails && (
          <section className="mt-8 rounded-3xl bg-gradient-to-br from-[#4c509c] to-[#5d61b9] p-6 text-white sm:p-8">
          <div className="grid gap-7 md:grid-cols-[1fr_1.25fr] md:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#e3f6ff]">
                <Lock className="size-3" /> Technical boundary
              </span>
              <h2 className="editorial-heading mt-4 text-[30px] leading-tight">The assistant can’t leak what it never retrieves.</h2>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {[
                ["01", "Resolve", "Identify user and organization"],
                ["02", "Authorize", "Intersect request with licenses"],
                ["03", "Retrieve", "Open only approved server files"],
              ].map(([number, title, detail]) => (
                <div key={number} className="rounded-2xl border border-white/12 bg-white/[0.06] p-4">
                  <p className="text-[9px] font-bold text-[#8eb4aa]">{number}</p>
                  <p className="mt-4 text-[11px] font-bold">{title}</p>
                  <p className="mt-1.5 text-[9px] leading-4 text-[#a9c1bb]">{detail}</p>
                </div>
              ))}
            </div>
          </div>
          </section>
        )}
      </div>
    </main>
  );
}

function AuditView({ events, loading }: { events: AuditEvent[]; loading: boolean }) {
  const actionMeta: Record<AuditEvent["action"], { label: string; color: string; icon: LucideIcon }> = {
    "query.completed": { label: "Completed", color: "bg-[#eeefff] text-[#4c509c]", icon: CheckCircle2 },
    "query.partial": { label: "Partial", color: "bg-[#f6eadf] text-[#9b6348]", icon: AlertCircle },
    "query.denied": { label: "Denied", color: "bg-[#f4e3dd] text-[#a7523b]", icon: XCircle },
    "query.unsupported": { label: "No evidence", color: "bg-[#eeece7] text-[#756f65]", icon: AlertCircle },
  };

  return (
    <main className="scroll-thin h-[calc(100vh-72px)] overflow-y-auto px-4 py-8 sm:px-8 lg:px-10">
      <div className="mx-auto max-w-[1030px] fade-up">
        <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#72827d]">Governance</p>
        <h1 className="editorial-heading mt-2 text-[38px] text-[#344a57]">Audit trail</h1>
        <p className="mt-3 max-w-[620px] text-[12px] leading-5 text-[#6e7b77]">Every query records which reports were searched, which were excluded, and whether an evidence-backed answer was produced. Report content itself is not duplicated in the log.</p>

        <div className="mt-8 overflow-hidden rounded-2xl border border-[#dce4e1] bg-white shadow-soft">
          <div className="grid grid-cols-[1fr_auto] items-center border-b border-[#e9eeec] bg-[#fafbfa] px-5 py-3.5">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#84918d]">Recent events</p>
            <span className="text-[9px] font-bold text-[#71817c]">{events.length} recorded</span>
          </div>
          {loading ? (
            <div className="p-10 text-center text-[11px] text-[#87938f]">Loading audit events…</div>
          ) : events.length === 0 ? (
            <div className="p-10 text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-[#f0f0ff] text-[#5d61b9]"><Activity className="size-5" /></span>
              <p className="mt-4 text-[12px] font-bold text-[#45534f]">No queries for this identity yet</p>
              <p className="mt-1.5 text-[10px] text-[#899590]">Ask a research question to create the first audit event.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#edf0ef]">
              {events.map((event) => {
                const meta = actionMeta[event.action];
                const Icon = meta.icon;
                return (
                  <div key={event.id} className="grid gap-4 px-5 py-4 hover:bg-[#fafcfa] sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[8px] font-extrabold uppercase tracking-[0.08em] ${meta.color}`}>
                          <Icon className="size-2.5" /> {meta.label}
                        </span>
                        <span className="font-mono text-[8px] text-[#9aa4a1]">{event.id}</span>
                      </div>
                      <p className="mt-2 truncate text-[11px] font-semibold text-[#44504d]">“{event.question}”</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[8px] font-semibold text-[#899590]">
                        <span>{event.searchedReports.length} searched</span>
                        <span>{event.blockedReports.length} blocked</span>
                        <span>{event.citationCount} citations</span>
                        {event.routingMode && (
                          <span>
                            {event.routingMode === "ai" ? "AI" : "Metadata"} routed {event.routedReports?.length ?? 0}
                            {event.routingConfidence === null || event.routingConfidence === undefined
                              ? ""
                              : ` · ${Math.round(event.routingConfidence * 100)}%`}
                          </span>
                        )}
                        <span>
                          {event.mode === "live"
                            ? "OpenAI live"
                            : event.mode === "verified"
                              ? "Verified math"
                              : event.mode === "policy"
                                ? "Access policy"
                                : event.mode === "grounded"
                                  ? "No-answer guard"
                                  : "Guided demo"}
                        </span>
                        <span className="font-mono">{event.reasonCode}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[9px] text-[#8a9692] sm:justify-end">
                      <Clock3 className="size-3" />
                      {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export function ResearchApp() {
  const [activeTab, setActiveTab] = useState<TabId>("assistant");
  const [selectedUserId, setSelectedUserId] = useState<UserId>("alex");
  const [context, setContext] = useState<ContextPayload | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState<WorkflowStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [evidenceViewer, setEvidenceViewer] = useState<EvidenceViewerState | null>(null);
  const [technicalDetails, setTechnicalDetails] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialContextLoadStarted = useRef(false);
  const closeViewer = useCallback(() => setEvidenceViewer(null), []);
  const openEvidence = useCallback<OpenEvidenceHandler>((targets, activeCitationId) => {
    if (!targets.length) return;
    const activeIndex = activeCitationId
      ? Math.max(0, targets.findIndex((target) => target.citation.id === activeCitationId))
      : 0;
    setEvidenceViewer({ targets, activeIndex });
  }, []);
  const selectEvidence = useCallback((activeIndex: number) => {
    setEvidenceViewer((current) => current
      ? { ...current, activeIndex: Math.max(0, Math.min(activeIndex, current.targets.length - 1)) }
      : current);
  }, []);

  const applyWorkspaceContext = useCallback((
    data: ContextPayload,
    history: HistoryIndexPayload,
  ) => {
    const userId = data.user.id;
    const restoreBlankChat = shouldRestoreBlankChat(userId);
    rememberDemoIdentity(userId);
    setSelectedUserId(userId);
    setContext(data);
    setMessages(restoreBlankChat ? [] : history.messages);
    setConversations(history.conversations);
    setActiveConversationId(restoreBlankChat ? null : history.activeConversationId);
  }, []);

  const loadContext = useCallback(async (userId: UserId) => {
    setError(null);
    try {
      await requestJson("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const [data, history] = await Promise.all([
        requestJson<ContextPayload>("/api/context"),
        requestJson<HistoryIndexPayload>("/api/history"),
      ]);
      if (data.user.id !== userId) throw new Error("The signed session did not match the selected identity.");
      applyWorkspaceContext(data, history);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the demo context.");
    }
  }, [applyWorkspaceContext]);

  const restoreSignedContext = useCallback(async () => {
    setError(null);
    const fallbackUserId = storedDemoIdentity();
    setSelectedUserId(fallbackUserId);

    try {
      const response = await fetch("/api/context", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (response.status === 401) {
        await loadContext(fallbackUserId);
        return;
      }

      const payload = await response.json().catch(() => ({ error: "The server returned an invalid response." }));
      if (!response.ok) {
        const message = typeof payload === "object" && payload && "error" in payload
          ? String(payload.error)
          : "Could not restore the signed demo session.";
        throw new Error(message);
      }

      const data = payload as ContextPayload;
      const history = await requestJson<HistoryIndexPayload>("/api/history", { cache: "no-store" });
      applyWorkspaceContext(data, history);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restore the demo context.");
    }
  }, [applyWorkspaceContext, loadContext]);

  const refreshAccessContext = useCallback(async () => {
    const data = await requestJson<ContextPayload>("/api/context");
    if (data.user.id !== selectedUserId) {
      throw new Error("The signed session changed while refreshing report access.");
    }
    setContext(data);
  }, [selectedUserId]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const data = await requestJson<{ events: AuditEvent[] }>("/api/audit");
      setAuditEvents(data.events);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialContextLoadStarted.current) return;
    initialContextLoadStarted.current = true;
    void restoreSignedContext();
  }, [restoreSignedContext]);

  useEffect(() => {
    setTechnicalDetails(storedTechnicalDetailsPreference());
  }, []);

  useEffect(() => {
    if (activeTab === "audit" && context?.user.id === selectedUserId) void loadAudit();
  }, [activeTab, context?.user.id, loadAudit, selectedUserId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, loadingSteps]);

  const latestResponse = useMemo(
    () => [...messages].reverse().find((message) => message.response)?.response,
    [messages],
  );
  const accessibleReportIds = useMemo(
    () => new Set(context?.reports.filter((report) => report.accessible).map((report) => report.id) ?? []),
    [context?.reports],
  );

  const handleUserChange = (userId: UserId) => {
    if (userId === selectedUserId || loading || conversationLoading || clearingHistory) return;
    setContext(null);
    setSelectedUserId(userId);
    setMessages([]);
    setConversations([]);
    setActiveConversationId(null);
    setQuestion("");
    setAuditEvents([]);
    setEvidenceViewer(null);
    setActiveTab("assistant");
    void loadContext(userId);
  };

  const startNewChat = () => {
    if (loading || conversationLoading || clearingHistory) return;
    rememberBlankChat(selectedUserId, true);
    setActiveConversationId(null);
    setMessages([]);
    setQuestion("");
    setEvidenceViewer(null);
    setError(null);
    setActiveTab("assistant");
  };

  const toggleTechnicalDetails = () => {
    setTechnicalDetails((current) => {
      const next = !current;
      rememberTechnicalDetailsPreference(next);
      return next;
    });
  };

  const selectConversation = async (conversationId: string) => {
    if (loading || conversationLoading || clearingHistory) return;
    if (conversationId === activeConversationId) {
      setActiveTab("assistant");
      return;
    }

    setConversationLoading(true);
    setError(null);
    setEvidenceViewer(null);
    setActiveTab("assistant");
    try {
      const stored = await requestJson<{
        conversation: ChatConversationSummary;
        messages: StoredChatMessage[];
      }>(`/api/history?conversationId=${encodeURIComponent(conversationId)}`);
      rememberBlankChat(selectedUserId, false);
      setActiveConversationId(stored.conversation.id);
      setMessages(stored.messages);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load that conversation.");
    } finally {
      setConversationLoading(false);
    }
  };

  const clearHistory = async () => {
    if (loading || conversationLoading || clearingHistory || conversations.length === 0) return;
    if (!window.confirm(`Clear the stored chat history for ${context?.user.name ?? "this identity"}?`)) return;

    setClearingHistory(true);
    setError(null);
    try {
      await requestJson<{ cleared: boolean }>("/api/history", { method: "DELETE" });
      setMessages([]);
      setConversations([]);
      setActiveConversationId(null);
      setQuestion("");
      setEvidenceViewer(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear chat history.");
    } finally {
      setClearingHistory(false);
    }
  };

  const submitQuestion = async (questionOverride?: string) => {
    const prompt = (questionOverride ?? question).trim();
    if (prompt.length < 3 || loading || conversationLoading || !context) return;
    const requestId = crypto.randomUUID();
    const submittedConversationId = activeConversationId;
    const optimisticConversationId = submittedConversationId ?? `pending-${requestId}`;
    const optimisticTimestamp = new Date().toISOString();
    let resolvedConversationId = submittedConversationId;

    const userMessage: ConversationMessage = {
      id: `user-${requestId}`,
      role: "user",
      content: prompt,
    };
    setMessages((current) => [...current, userMessage]);
    setActiveConversationId(optimisticConversationId);
    setConversations((current) => {
      const existing = submittedConversationId
        ? current.find((conversation) => conversation.id === submittedConversationId)
        : undefined;
      const optimistic: ChatConversationSummary = existing
        ? {
            ...existing,
            updatedAt: optimisticTimestamp,
            messageCount: existing.messageCount + 1,
          }
        : {
            id: optimisticConversationId,
            title: chatTitle(prompt),
            createdAt: optimisticTimestamp,
            updatedAt: optimisticTimestamp,
            messageCount: 1,
          };
      return [
        optimistic,
        ...current.filter((conversation) => conversation.id !== optimistic.id),
      ].slice(0, 20);
    });
    setQuestion("");
    setLoading(true);
    setLoadingSteps([]);
    setError(null);

    try {
      const response = await requestChatStream(
        {
          requestId,
          question: prompt,
          ...(submittedConversationId ? { conversationId: submittedConversationId } : {}),
        },
        (step) => setLoadingSteps((current) => [
          ...current.filter((existing) => existing.id !== step.id),
          step,
        ]),
        (serverConversationId) => {
          resolvedConversationId = serverConversationId;
          rememberBlankChat(selectedUserId, false);
          setActiveConversationId(serverConversationId);
          setConversations((current) => current.map((conversation) => (
            conversation.id === optimisticConversationId
              ? { ...conversation, id: serverConversationId }
              : conversation
          )));
        },
      );
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${requestId}`,
          role: "assistant",
          content: response.answer,
          response,
        },
      ]);
      setActiveConversationId(response.conversationId);
      setConversations((current) => current.map((conversation) => (
        conversation.id === response.conversationId
          ? { ...conversation, messageCount: conversation.messageCount + 1 }
          : conversation
      )));
      void requestJson<HistoryIndexPayload>("/api/history")
        .then((stored) => setConversations(stored.conversations))
        .catch(() => undefined);
      setContext((current) => current ? { ...current, auditCount: current.auditCount + 1 } : current);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The assistant request failed.";
      setError(message);
      setMessages((current) => [
        ...current,
        { id: `assistant-error-${Date.now()}`, role: "assistant", content: `I couldn’t complete that request: ${message}` },
      ]);
      if (!resolvedConversationId && !submittedConversationId) {
        setConversations((current) => current.filter(
          (conversation) => conversation.id !== optimisticConversationId,
        ));
        setActiveConversationId(null);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        auditCount={context?.auditCount ?? 0}
        reportCount={context?.reports.length ?? 0}
        licensedReportCount={context?.reports.filter((report) => report.accessible).length ?? 0}
        reportDirectory={context?.reportDirectory ?? "data/reports"}
        quarantinedCount={context?.quarantinedCount ?? 0}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onNewChat={startNewChat}
        onSelectConversation={(conversationId) => void selectConversation(conversationId)}
        conversationBusy={loading || conversationLoading || clearingHistory}
        technicalDetails={technicalDetails}
      />
      <div className={`workspace-shell min-w-0 lg:ml-[244px] ${evidenceViewer ? "workspace-source-open" : ""}`}>
        <Header
          context={context}
          selectedUserId={selectedUserId}
          onSelectUser={handleUserChange}
          onOpenMenu={() => setMobileNavOpen(true)}
          onClearHistory={() => void clearHistory()}
          canClearHistory={conversations.length > 0 && !loading && !conversationLoading}
          clearingHistory={clearingHistory}
          sessionBusy={loading || conversationLoading || clearingHistory}
          onNewChat={startNewChat}
          technicalDetails={technicalDetails}
          onToggleTechnicalDetails={toggleTechnicalDetails}
        />

        {!context ? (
          <main className="grid h-[calc(100vh-72px)] place-items-center px-4">
            {error ? (
              <div className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-soft">
                <AlertCircle className="mx-auto size-6 text-red-500" />
                <p className="mt-3 text-[12px] font-bold text-[#4b3832]">{error}</p>
                <button onClick={() => void loadContext(selectedUserId)} className="mt-4 rounded-lg bg-[#5d61b9] px-4 py-2 text-[10px] font-bold text-white transition hover:bg-[#494da2]">Try again</button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-[11px] font-semibold text-[#75817d]">
                <span className="size-2 animate-pulse rounded-full bg-[#5d61b9]" /> Loading secure workspace…
              </div>
            )}
          </main>
        ) : activeTab === "library" ? (
          <LibraryView context={context} technicalDetails={technicalDetails} />
        ) : activeTab === "audit" ? (
          <AuditView events={auditEvents} loading={auditLoading} />
        ) : (
          <div className={`grid h-[calc(100vh-72px)] min-h-0 ${evidenceViewer ? "" : "xl:grid-cols-[minmax(0,1fr)_350px]"}`}>
            <main className="flex min-h-0 min-w-0 flex-col">
              <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                {messages.length === 0 && !loading ? (
                  <Welcome
                    context={context}
                    onAsk={(value) => void submitQuestion(value)}
                    technicalDetails={technicalDetails}
                  />
                ) : (
                  <Conversation
                    messages={messages}
                    loading={loading}
                    loadingSteps={loadingSteps}
                    onOpenEvidence={openEvidence}
                    technicalDetails={technicalDetails}
                    accessibleReportIds={accessibleReportIds}
                    organization={context.user.organization}
                    onAccessChanged={refreshAccessContext}
                    onRetry={(value) => void submitQuestion(value)}
                  />
                )}
              </div>
              {error && (
                <div className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-[9px] font-semibold text-red-700 sm:mx-7">
                  <AlertCircle className="size-3" /> {error}
                </div>
              )}
              <Composer
                value={question}
                setValue={setQuestion}
                onSubmit={() => void submitQuestion()}
                disabled={loading || conversationLoading}
                mode={context.aiMode}
              />
            </main>
            {!evidenceViewer && (
              <AccessPanel
                context={context}
                latest={latestResponse}
                onOpenEvidence={openEvidence}
                technicalDetails={technicalDetails}
              />
            )}
          </div>
        )}
      </div>
      {evidenceViewer && (
        <ReportViewer
          viewer={evidenceViewer}
          onSelect={selectEvidence}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}
