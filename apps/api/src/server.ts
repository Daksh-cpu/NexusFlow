import "./env.js"; // CRITICAL: Load env before anything else
import cors from "cors";
import express from "express";
import { graph } from "@packages/graph";
import { RerankerService } from "@packages/retrieval";
import { AnalyzeRequestSchema, IngestRequestSchema } from "@packages/shared";
import { HumanMessage } from "@langchain/core/messages";
import { saveReport, listReports, getReport, deleteReport } from "./reports.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "3.0.0", agents: ["bull_analyst", "bear_analyst", "critic", "executive"] });
});

app.get("/config", (_req, res) => {
  res.json({
    reranker: { provider: process.env.RERANKER_PROVIDER || "cohere", model: process.env.COHERE_RERANK_MODEL || "rerank-english-v3.0" },
    architecture: "adversarial-debate-with-critic",
    agents: ["generate_queries", "retrieve_documents", "bull_analyst", "bear_analyst", "critic", "synthesize"]
  });
});

app.post("/ingest", async (req, res) => {
  const parsed = IngestRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  return res.json({ message: "Ingestion not implemented in this version", ingestedSources: 0 });
});

app.post("/analyze", async (req, res) => {
  try {
    const parsed = AnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    
    const initialState = {
      messages: [new HumanMessage(parsed.data.question)],
    };
    
    const result: any = await graph.invoke(initialState);
    
    // Save to history
    saveReport({
      id: result.reportId || `report_${Date.now()}`,
      company: parsed.data.company,
      question: parsed.data.question,
      bullAnalysis: result.bullAnalysis || "",
      bearAnalysis: result.bearAnalysis || "",
      criticReview: result.criticReview || "",
      synthesis: result.synthesis || "",
      documentCount: result.documents?.length || 0,
      createdAt: new Date().toISOString(),
    });

    return res.json({
      synthesis: result.synthesis,
      bullAnalysis: result.bullAnalysis,
      bearAnalysis: result.bearAnalysis,
      criticReview: result.criticReview,
    });
  } catch (error) {
    console.error("Analyze error:", error);
    return res.status(500).json({ error: "Analysis failed. Please try again." });
  }
});

app.get("/analyze/stream", async (req, res) => {
  const company = String(req.query.company || "");
  const question = String(req.query.question || "");
  if (!company || !question) {
    return res.status(400).json({ error: "company and question are required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (event: string, payload: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    // 1. Check Cache
    const existingReports = listReports();
    const cachedReport = existingReports.find(
      r => r.company.toLowerCase() === company.toLowerCase() && r.question === question
    );

    if (cachedReport) {
      console.log(`[Cache Hit] Streaming cached report for ${company}`);
      // Simulate the agent pipeline instantly
      send("agent", { node: "generate_queries", update: { queries: ["Cached Query 1", "Cached Query 2", "Cached Query 3"] } });
      send("agent", { node: "retrieve_documents", update: { documents: new Array(cachedReport.documentCount).fill({}) } });
      send("agent", { node: "bull_analyst", update: { bullAnalysis: cachedReport.bullAnalysis } });
      send("agent", { node: "bear_analyst", update: { bearAnalysis: cachedReport.bearAnalysis } });
      send("agent", { node: "critic", update: { criticReview: cachedReport.criticReview } });
      send("agent", { node: "synthesize", update: { synthesis: cachedReport.synthesis, reportId: cachedReport.id } });
      send("final", cachedReport.synthesis);
      return res.end();
    }

    // 2. No cache, run the full pipeline
    const initialState = {
      messages: [new HumanMessage(question)],
    };

    const stream = await graph.stream(initialState);
    let finalReport = "";
    let reportData: any = {};

    for await (const chunk of stream) {
      for (const [nodeName, stateUpdate] of Object.entries(chunk)) {
        send("agent", { node: nodeName, update: stateUpdate });
        const update = stateUpdate as any;
        if (update.synthesis) finalReport = update.synthesis;
        if (update.bullAnalysis) reportData.bullAnalysis = update.bullAnalysis;
        if (update.bearAnalysis) reportData.bearAnalysis = update.bearAnalysis;
        if (update.criticReview) reportData.criticReview = update.criticReview;
        if (update.reportId) reportData.reportId = update.reportId;
        if (update.documents) reportData.documentCount = update.documents.length;
      }
    }

    // Save to history
    saveReport({
      id: reportData.reportId || `report_${Date.now()}`,
      company,
      question,
      bullAnalysis: reportData.bullAnalysis || "",
      bearAnalysis: reportData.bearAnalysis || "",
      criticReview: reportData.criticReview || "",
      synthesis: finalReport,
      documentCount: reportData.documentCount || 0,
      createdAt: new Date().toISOString(),
    });

    send("final", finalReport);
  } catch (error) {
    console.error("Streaming error:", error);
    send("error", { message: "Analysis encountered an error. Please try again." });
  }

  res.end();
});

// ─────────────────────────────────────────────
// Research History Endpoints
// ─────────────────────────────────────────────
app.get("/reports", (_req, res) => {
  const reports = listReports();
  // Return lightweight summaries (no full analysis text)
  const summaries = reports.map(r => ({
    id: r.id,
    company: r.company,
    question: r.question,
    documentCount: r.documentCount,
    createdAt: r.createdAt,
    preview: r.synthesis?.slice(0, 150) || "",
  }));
  res.json(summaries);
});

app.get("/reports/:id", (req, res) => {
  const report = getReport(req.params.id);
  if (!report) return res.status(404).json({ error: "Report not found" });
  res.json(report);
});

app.delete("/reports/:id", (req, res) => {
  const deleted = deleteReport(req.params.id);
  if (!deleted) return res.status(404).json({ error: "Report not found" });
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`\n🚀 NexusFlow API v3.0 listening on port ${port}`);
  console.log(`   Architecture: Adversarial Debate + Critic`);
  console.log(`   Endpoints:`);
  console.log(`     GET  /health`);
  console.log(`     GET  /config`);
  console.log(`     POST /analyze`);
  console.log(`     GET  /analyze/stream`);
  console.log(`     GET  /reports`);
  console.log(`     GET  /reports/:id`);
  console.log(`     DEL  /reports/:id\n`);
});
