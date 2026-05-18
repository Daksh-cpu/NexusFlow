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
  
  if (!process.env.TAVILY_API_KEY) {
    return res.status(500).json({ error: "TAVILY_API_KEY is not set in environment variables." });
  }
  
  try {
    // Step 1: Fetch search results from Tavily
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 5 })
    });
    
    if (!tavilyRes.ok) {
      const errText = await tavilyRes.text().catch(() => "Unknown Tavily error");
      console.error("Tavily API error:", tavilyRes.status, errText);
      return res.status(502).json({ error: `Tavily API returned ${tavilyRes.status}: ${errText}` });
    }
    
    const tavilyData = await tavilyRes.json();
    const results = tavilyData.results || [];
    
    if (results.length === 0) {
      return res.json({ answer: "No search results were found for this query. Try a different search term." });
    }
    
    const searchResults = results.map((r: any) => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`).join('\n\n');
    
    // Step 2: Summarize with LLM
    const llm = getFastLLM();
    const prompt = new SystemMessage(`You are a direct, highly accurate intelligence search assistant. 
Answer the following query using ONLY the provided search results. Include inline markdown links to the sources [Source Name](url).

Query: ${query}

Search Results:
${searchResults}`);
    
    const response = await llm.invoke([prompt, new HumanMessage(query)]);
    const answer = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    
    res.json({ answer: answer || "The AI model returned an empty response. Please try again." });
  } catch (error) {
    console.error("Web search error:", error);
    res.status(500).json({ error: String(error) });
  }
});

// ─────────────────────────────────────────────
// Alternate Reality Simulator Endpoints
// ─────────────────────────────────────────────

// Step 1: Initialize simulation — parse scenario, generate Python model, run initial sim
app.post("/simulate/init", async (req, res) => {
  const { scenario } = req.body;
  if (!scenario) {
    return res.status(400).json({ error: "Scenario is required" });
  }

  try {
    const llm = getFastLLM();

    // Parse scenario into structured variables
    const parsePrompt = new SystemMessage(`You are a quantitative scenario parser. Given a hypothetical scenario, extract 2-4 numeric variables that can be adjusted with sliders.

Return ONLY valid JSON (no markdown, no code blocks) in this exact format:
{
  "company": "Company Name",
  "variables": [
    { "name": "variable_name", "label": "Human Label", "min": 0, "max": 300, "default": 200, "step": 10, "unit": "%" },
    { "name": "another_var", "label": "Another Variable", "min": 0, "max": 10, "default": 3, "step": 1, "unit": "years" }
  ],
  "baseContext": "Brief 1-2 sentence context about current market conditions relevant to this scenario"
}

Rules:
- Variable names must be valid Python identifiers (snake_case)
- Choose sensible min/max ranges centered around the default
- Unit should be one of: %, years, $, x, pts`);

    const parseResponse = await llm.invoke([parsePrompt, new HumanMessage(scenario)]);
    const parseText = typeof parseResponse.content === "string" ? parseResponse.content : JSON.stringify(parseResponse.content);

    let parsed;
    try {
      // Extract JSON from potential markdown wrapping
      const jsonMatch = parseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : parseText);
    } catch {
      return res.status(500).json({ error: "Failed to parse scenario into variables. Try rephrasing." });
    }

    // Generate Monte Carlo Python simulation code
    const codePrompt = new SystemMessage(`You are a quantitative Python developer. Write a Monte Carlo simulation script for the given scenario.

STRICT RULES:
1. Return ONLY raw Python code. No markdown, no backticks.
2. Define a function called simulate() that takes the scenario variables as keyword arguments plus trials=10000.
3. The function should return a dict with keys: mean, std, p5, p95 (percentile values).
4. Use numpy for random sampling and calculations.
5. After defining simulate(), call it with the default values and print the results as JSON.
6. Also generate TWO matplotlib charts:
   - Figure 1: A histogram of the outcome distribution with a vertical line at the mean
   - Figure 2: A line chart showing simulated price trajectory over 12 months
7. Use plt.style.use('dark_background') for both charts.
8. Use a modern color palette (use '#ff8c00' as the primary color).
9. DO NOT use plt.show(). The sandbox captures figures automatically.
10. Create a single figure with 2 subplots side by side.

Scenario: ${scenario}
Variables: ${JSON.stringify(parsed.variables)}
Context: ${parsed.baseContext}`);

    const codeResponse = await llm.invoke([codePrompt, new HumanMessage(scenario)]);
    let code = typeof codeResponse.content === "string" ? codeResponse.content : String(codeResponse.content);
    code = code.replace(/```python/g, "").replace(/```/g, "").trim();

    // Execute in E2B sandbox
    const result = await executeTerminalCommand(code);

    // Parse stats from stdout
    let stats = { mean: 0, std: 0, p5: 0, p95: 0 };
    try {
      const jsonMatch = (result.stdout || "").match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed_stats = JSON.parse(jsonMatch[0]);
        stats = {
          mean: Number(parsed_stats.mean) || 0,
          std: Number(parsed_stats.std) || 0,
          p5: Number(parsed_stats.p5) || 0,
          p95: Number(parsed_stats.p95) || 0,
        };
      }
    } catch {
      console.warn("Could not parse simulation stats from stdout");
    }

    // Get initial agent commentary
    let commentary = { researcher: "", analyst: "", critic: "", executive: "" };
    try {
      const commentaryRes = await getSimCommentary(llm, scenario, parsed.variables, stats);
      commentary = commentaryRes;
    } catch (e) {
      console.warn("Initial commentary generation failed:", e);
    }

    res.json({
      company: parsed.company,
      variables: parsed.variables.map((v: any) => ({ ...v, value: v.default })),
      chart: result.chart || "",
      stats,
      commentary,
      code_initialized: true,
    });
  } catch (error) {
    console.error("Simulation init error:", error);
    res.status(500).json({ error: String(error) });
  }
});

// Step 2: Update simulation with new slider values
app.post("/simulate/update", async (req, res) => {
  const { variables } = req.body;
  if (!variables || typeof variables !== "object") {
    return res.status(400).json({ error: "Variables object is required" });
  }

  try {
    // Build a Python call to the already-defined simulate() function
    const args = Object.entries(variables).map(([k, v]) => `${k}=${v}`).join(", ");
    const code = `
import json
result = simulate(${args})
print(json.dumps(result))

# Regenerate charts with new values
import matplotlib.pyplot as plt
import numpy as np
plt.style.use('dark_background')

outcomes = [simulate(${args}, trials=1)['mean'] for _ in range(5000)]
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

# Histogram
ax1.hist(outcomes, bins=60, color='#ff8c00', alpha=0.8, edgecolor='#1a1a1a')
ax1.axvline(np.mean(outcomes), color='white', linestyle='--', linewidth=1.5, label=f'Mean: {np.mean(outcomes):.2f}%')
ax1.set_title('Outcome Distribution', fontsize=14, fontweight='bold', color='white')
ax1.set_xlabel('Stock Price Change (%)', color='#aaa')
ax1.set_ylabel('Frequency', color='#aaa')
ax1.legend(fontsize=10)
ax1.grid(alpha=0.15)

# Trajectory
months = np.arange(1, 13)
base = 100
trajectory = [base]
monthly_change = np.mean(outcomes) / 12
for m in months[:-1]:
    trajectory.append(trajectory[-1] * (1 + monthly_change/100 + np.random.normal(0, abs(np.std(outcomes)/100/3))))
ax2.plot(months, trajectory[:12], color='#ff8c00', linewidth=2.5)
ax2.fill_between(months, [t * 0.95 for t in trajectory[:12]], [t * 1.05 for t in trajectory[:12]], alpha=0.15, color='#ff8c00')
ax2.set_title('Projected 12-Month Trajectory', fontsize=14, fontweight='bold', color='white')
ax2.set_xlabel('Month', color='#aaa')
ax2.set_ylabel('Indexed Price', color='#aaa')
ax2.grid(alpha=0.15)

plt.tight_layout()
`;

    const result = await executeTerminalCommand(code);

    let stats = { mean: 0, std: 0, p5: 0, p95: 0 };
    try {
      const jsonMatch = (result.stdout || "").match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed_stats = JSON.parse(jsonMatch[0]);
        stats = {
          mean: Number(parsed_stats.mean) || 0,
          std: Number(parsed_stats.std) || 0,
          p5: Number(parsed_stats.p5) || 0,
          p95: Number(parsed_stats.p95) || 0,
        };
      }
    } catch {
      console.warn("Could not parse update stats from stdout");
    }

    res.json({ chart: result.chart || "", stats });
  } catch (error) {
    console.error("Simulation update error:", error);
    res.status(500).json({ error: String(error) });
  }
});

// Step 3: Get agent commentary (called debounced from frontend)
app.post("/simulate/commentary", async (req, res) => {
  const { scenario, variables, stats } = req.body;
  if (!scenario) {
    return res.status(400).json({ error: "Scenario is required" });
  }

  try {
    const llm = getFastLLM();
    const commentary = await getSimCommentary(llm, scenario, variables || [], stats || {});
    res.json(commentary);
  } catch (error) {
    console.error("Commentary error:", error);
    res.status(500).json({ error: String(error) });
  }
});

// Helper: Generate 4 agent commentaries in parallel
async function getSimCommentary(llm: any, scenario: string, variables: any[], stats: any) {
  const context = `Scenario: ${scenario}\nVariables: ${JSON.stringify(variables)}\nSimulation Results: Mean=${stats.mean?.toFixed(2)}%, StdDev=${stats.std?.toFixed(2)}%, 5th Percentile=${stats.p5?.toFixed(2)}%, 95th Percentile=${stats.p95?.toFixed(2)}%`;

  const [researcher, analyst, critic, executive] = await Promise.all([
    llm.invoke([new SystemMessage(`You are a market researcher. In 2-3 sentences, cite relevant real-world market data that supports or contradicts this simulation scenario. Be specific with numbers.\n\n${context}`), new HumanMessage("Provide your analysis.")]).then((r: any) => typeof r.content === "string" ? r.content : String(r.content)),
    llm.invoke([new SystemMessage(`You are a quantitative analyst. In 2-3 sentences, interpret the Monte Carlo simulation results. Focus on the mean outcome, the spread (std dev), and what the percentiles tell us about risk.\n\n${context}`), new HumanMessage("Provide your analysis.")]).then((r: any) => typeof r.content === "string" ? r.content : String(r.content)),
    llm.invoke([new SystemMessage(`You are a risk critic. In 2-3 sentences, highlight the key assumptions and limitations of this simulation. What real-world factors might the model be missing?\n\n${context}`), new HumanMessage("Provide your analysis.")]).then((r: any) => typeof r.content === "string" ? r.content : String(r.content)),
    llm.invoke([new SystemMessage(`You are a chief investment strategist. In 2-3 sentences, give an actionable recommendation based on these simulation results. Be decisive — recommend BUY, HOLD, or SELL with a confidence level.\n\n${context}`), new HumanMessage("Provide your recommendation.")]).then((r: any) => typeof r.content === "string" ? r.content : String(r.content)),
  ]);

  return { researcher, analyst, critic, executive };
}

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`\n🚀 NexusFlow API v4.0 listening on port ${port}`);
  console.log(`   Architecture: Adversarial Debate + Critic + Simulator`);
  console.log(`   Endpoints:`);
  console.log(`     GET  /health`);
  console.log(`     GET  /config`);
  console.log(`     POST /analyze`);
  console.log(`     GET  /analyze/stream`);
  console.log(`     GET  /reports`);
  console.log(`     GET  /reports/:id`);
  console.log(`     DEL  /reports/:id`);
  console.log(`     POST /terminal/execute`);
  console.log(`     POST /search`);
  console.log(`     POST /simulate/init`);
  console.log(`     POST /simulate/update`);
  console.log(`     POST /simulate/commentary\n`);
});
