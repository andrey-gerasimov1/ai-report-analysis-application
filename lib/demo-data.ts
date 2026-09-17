import type { DemoUser, ReportId, UserId } from "@/lib/types";

export const USERS: DemoUser[] = [
  {
    id: "alex",
    name: "Alex Morgan",
    initials: "AM",
    role: "Director, Market Strategy",
    organization: "Clearview Insights",
    accent: "#5d61b9",
    reportIds: [],
  },
  {
    id: "jordan",
    name: "Jordan Lee",
    initials: "JL",
    role: "Energy Strategy Analyst",
    organization: "Clearview Insights",
    accent: "#a4771c",
    reportIds: [],
  },
  {
    id: "taylor",
    name: "Taylor Chen",
    initials: "TC",
    role: "Automation Portfolio Manager",
    organization: "Vector Labs",
    accent: "#4b5057",
    reportIds: [],
  },
];

export const getUser = (userId: string): DemoUser | undefined =>
  USERS.find((user) => user.id === userId);

export const isUserId = (value: string): value is UserId =>
  USERS.some((user) => user.id === value);

export const SUGGESTED_QUESTIONS = [
  {
    label: "Market outlook",
    question: "What is the North American grid storage market value, forecast, and main growth story?",
    reportId: "report-storage" as ReportId,
  },
  {
    label: "Competitive share",
    question: "Who leads the warehouse robotics market, and how large is the gap to the next competitor?",
    reportId: "report-robotics" as ReportId,
  },
  {
    label: "Cross-report synthesis",
    question: "Compare the growth outlook and competitive dynamics across both licensed reports.",
    reportId: null,
  },
];
