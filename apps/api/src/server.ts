import "./env.js"; // CRITICAL: Load env before anything else
import cors from "cors";
import express from "express";
import { graph, executeTerminalCommand, getFastLLM } from "@packages/graph";
import { RerankerService } from "@packages/retrieval";
import { AnalyzeRequestSchema, IngestRequestSchema } from "@packages/shared";
import { HumanMessage } from "@langchain/core/messages";
import { saveReport, listReports, getReport, deleteReport } from "./reports.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

import { SystemMessage } from "@langchain/core/messages";

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

    const stream = graph.streamEvents(initialState, { version: "v2" });
    let finalReport = "";
    let reportData: any = {};
    let currentNodeName = "";

    for await (const event of stream) {
      const kind = event.event;

      // Track which node is currently running
      if (kind === "on_chain_start" && event.metadata?.langgraph_node) {
        const nodeName = event.metadata.langgraph_node;
        if (nodeName !== currentNodeName) {
          currentNodeName = nodeName;
        }
      }

      // Stream individual LLM tokens to the frontend
      if (kind === "on_chat_model_stream" && currentNodeName) {
        const chunk = event.data?.chunk;
        if (chunk?.content) {
          const text = typeof chunk.content === "string" ? chunk.content : "";
          if (text) {
            send("token", { node: currentNodeName, text });
          }
        }
      }

      // Node completion — send full state update
      if (kind === "on_chain_end" && event.metadata?.langgraph_node && event.data?.output) {
        const nodeName = event.metadata.langgraph_node;
        const output = event.data.output;
        
        // Only send for our actual graph nodes, skip internal chains
        if (["generate_queries", "retrieve_documents", "bull_analyst", "bear_analyst", "data_analyst", "critic", "synthesize"].includes(nodeName)) {
          send("agent", { node: nodeName, update: output });
          if (output.synthesis) finalReport = output.synthesis;
          if (output.bullAnalysis) reportData.bullAnalysis = output.bullAnalysis;
          if (output.bearAnalysis) reportData.bearAnalysis = output.bearAnalysis;
          if (output.criticReview) reportData.criticReview = output.criticReview;
          if (output.reportId) reportData.reportId = output.reportId;
          if (output.documents) reportData.documentCount = output.documents.length;
          if (output.dataAnalysisOutput) reportData.dataAnalysisOutput = output.dataAnalysisOutput;
          if (output.dataAnalysisChart) reportData.dataAnalysisChart = output.dataAnalysisChart;
        }
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

// ─────────────────────────────────────────────
// Terminal Feature Endpoint
// ─────────────────────────────────────────────
app.post("/terminal/execute", async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: "Code is required" });
  }
  try {
    const result = await executeTerminalCommand(code);
    res.json(result);
  } catch (error) {
    console.error("Terminal execution error:", error);
    res.status(500).json({ error: String(error) });
  }
});

// ─────────────────────────────────────────────
// Web Search Feature Endpoint
// ─────────────────────────────────────────────
app.post("/search", async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }
  
  try {
    // Direct fetch to avoid langchain/community peer dependency issues
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 5 })
    });
    const tavilyData = await tavilyRes.json();
    const searchResults = tavilyData.results?.map((r: any) => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`).join('\n\n') || "No results found.";
    
    const llm = getFastLLM();
    const prompt = new SystemMessage(`You are a direct, highly accurate intelligence search assistant. 
Answer the following query using ONLY the provided search results. Include inline markdown links to the sources [Source Name](url).

Query: ${query}

Search Results:
${searchResults}`);
    
    const response = await llm.invoke([prompt, new HumanMessage(query)]);
    res.json({ answer: response.content });
  } catch (error) {
    console.error("Web search error:", error);
    res.status(500).json({ error: String(error) });
  }
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
