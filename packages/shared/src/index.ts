import { z } from "zod";

export const IngestSourceSchema = z.object({
  id: z.string(),
  company: z.string(),
  type: z.enum(["pdf", "html", "sec", "text"]),
  title: z.string(),
  content: z.string(),
  publishedAt: z.string().optional(),
  trustScore: z.number().min(0).max(1).default(0.7)
});

export const IngestRequestSchema = z.object({
  sources: z.array(IngestSourceSchema).min(1)
});

export const AnalyzeRequestSchema = z.object({
  question: z.string().min(5),
  company: z.string().min(1)
});

export const CitationSchema = z.object({
  sourceId: z.string(),
  snippet: z.string(),
  score: z.number()
});

export const FinalReportSchema = z.object({
  company: z.string(),
  question: z.string(),
  decision: z.enum(["Invest", "Wait", "Sell"]),
  confidence: z.number().min(0).max(1),
  bullCase: z.array(z.string()),
  bearCase: z.array(z.string()),
  risks: z.array(z.string()),
  nextActions: z.array(z.string()),
  citations: z.array(CitationSchema)
});

export type IngestSource = z.infer<typeof IngestSourceSchema>;
export type IngestRequest = z.infer<typeof IngestRequestSchema>;
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type FinalReport = z.infer<typeof FinalReportSchema>;

export type AgentEvent = {
  node: "queryExpansion" | "retrieval" | "researcher" | "analyst" | "critic" | "executive" | "system";
  message: string;
  metadata?: Record<string, unknown>;
};
