import { ResearchState } from "./state.js";
import { ChatCohere } from "@langchain/cohere";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createRetrievalPipeline, getVectorStore, getWebSearchTool } from "@packages/retrieval";
import { Document } from "@langchain/core/documents";
import { Sandbox } from "@e2b/code-interpreter";

let _heavyLlm: ChatCohere | null = null;
const getHeavyLLM = () => {
  if (!_heavyLlm) {
    _heavyLlm = new ChatCohere({
      model: "command-r-plus-08-2024",
      temperature: 0,
      streaming: true,
      apiKey: process.env.COHERE_API_KEY,
    });
  }
  return _heavyLlm;
};

let _fastLlm: ChatCohere | null = null;
export const getFastLLM = () => {
  if (!_fastLlm) {
    _fastLlm = new ChatCohere({
      model: "command-r-08-2024", // Lightning fast model for sub-agents
      temperature: 0,
      streaming: true,
      apiKey: process.env.COHERE_API_KEY,
    });
  }
  return _fastLlm;
};

// Singleton Persistent E2B Sandbox
let warmSandbox: Sandbox | null = null;

// Expose a helper to let the Terminal UI interact with the sandbox directly
export const executeTerminalCommand = async (code: string) => {
  if (!warmSandbox) {
    warmSandbox = await Sandbox.create({ 
      apiKey: process.env.E2B_API_KEY, 
      timeoutMs: 3600000 // 1 hour
    });
  }
  
  const execution = await warmSandbox.runCode(code);
  let chartBase64 = null;

  if (execution.results.length > 0) {
    for (const result of execution.results) {
      if (result.png) {
        chartBase64 = `data:image/png;base64,${result.png}`;
        break;
      } else if (result.jpeg) {
        chartBase64 = `data:image/jpeg;base64,${result.jpeg}`;
        break;
      }
    }
  }

  return {
    stdout: execution.logs.stdout.join("\n"),
    stderr: execution.logs.stderr.join("\n"),
    chart: chartBase64,
  };
};

// ─────────────────────────────────────────────
// Node 1: Generate Research Queries
// ─────────────────────────────────────────────
export const generateQueriesNode = async (state: ResearchState): Promise<Partial<ResearchState>> => {
  const llm = getFastLLM();
  const lastMessage = state.messages[state.messages.length - 1];
  
  const prompt = new SystemMessage(`Generate 3 focused, diverse search queries for the user's request. Each query should target a different angle:
- Query 1: Financial performance and metrics
- Query 2: Market position and competitive landscape
- Query 3: Risks, challenges, and future outlook

Return ONLY the queries, one per line. No numbering, no explanations.`);
  
  const response = await llm.invoke([prompt, lastMessage]);
  const queries = response.content.toString().split("\n").filter(q => q.trim().length > 0).slice(0, 3);
  
  const reportId = `report_${Date.now()}`;
  
  return { queries, reportId };
};

// ─────────────────────────────────────────────
// Node 2: Retrieve Documents (PARALLELIZED)
// ─────────────────────────────────────────────
export const retrieveDocumentsNode = async (state: ResearchState): Promise<Partial<ResearchState>> => {
  if (!state.queries || state.queries.length === 0) {
    return { documents: [] };
  }

  const startTime = Date.now();
  
  const webSearch = getWebSearchTool();
  let localRetriever = null;
  try {
    const vectorStore = await getVectorStore("research_collection");
    localRetriever = createRetrievalPipeline(vectorStore.asRetriever(10), 3);
    console.log("Local vector store initialized.");
  } catch {
    console.warn("Qdrant offline. Web search only.");
  }

  const searchPromises: Promise<Document[]>[] = [];

  for (const query of state.queries) {
    if (localRetriever) {
      searchPromises.push(
        localRetriever.invoke(query).catch(() => [] as Document[])
      );
    }
    if (webSearch) {
      searchPromises.push(
        (async () => {
          try {
            const webResults = await webSearch.invoke({ query });
            const parsed = typeof webResults === "string" ? JSON.parse(webResults) : webResults;
            if (Array.isArray(parsed)) {
              return parsed.map((res: any) => new Document({
                pageContent: res.content || res.snippet || JSON.stringify(res),
                metadata: { source: res.url || "web", title: res.title || "Web Result", type: "web" }
              }));
            }
            return [new Document({ pageContent: String(webResults), metadata: { source: "web", type: "web" } })];
          } catch {
            return [] as Document[];
          }
        })()
      );
    }
  }

  const results = await Promise.all(searchPromises);
  const allDocs = results.flat();
  const uniqueDocs = Array.from(new Map(allDocs.map(d => [d.pageContent, d])).values());
  
  console.log(`Retrieval: ${uniqueDocs.length} unique docs in ${Date.now() - startTime}ms`);
  return { documents: uniqueDocs };
};

// ─────────────────────────────────────────────
// Node 3: Data Analyst (E2B Python Sandbox)
// ─────────────────────────────────────────────
export const dataAnalystNode = async (state: ResearchState): Promise<Partial<ResearchState>> => {
  // We wrap the entire node in a strict 45-second timeout to prevent it from hanging the parallel LangGraph pipeline
  const timeoutPromise = new Promise<Partial<ResearchState>>((resolve) => 
    setTimeout(() => resolve({ dataAnalysisOutput: "Quantitative analysis timed out after 45 seconds." }), 45000)
  );

  const executeNode = async (): Promise<Partial<ResearchState>> => {
    const llm = getFastLLM();
    const userQuery = state.messages[0];
    const docsText = (state.documents || []).map((d, i) => `[${i + 1}] ${d.pageContent}`).join("\n\n");

    // Step 1: Prompt LLM to write Python code for a chart
    const prompt = new SystemMessage(`You are a quantitative data analyst. Your job is to extract numerical data related to the user's query and write a Python script using Seaborn to visualize it.
    
  STRICT RULES:
  1. ONLY return the raw Python code. Do not wrap it in markdown block quotes (\`\`\`python). Just the code.
  2. You MUST use Seaborn to create a line chart or bar chart (unless the prompt specifically requests otherwise). 
  3. DO NOT use plt.show(). The E2B sandbox will automatically capture any generated figures.
  4. Keep the design beautiful and modern. Use a dark background theme (plt.style.use('dark_background')).
  5. The code should print a brief text summary of the data findings to stdout.

  Evidence:
  ${docsText}`);

    let code = "";
    try {
      const response = await llm.invoke([prompt, userQuery]);
      code = response.content.toString().replace(/```python/g, "").replace(/```/g, "").trim();
      console.log("Data Analyst generated Python code:\n", code);
    } catch (e) {
      console.error("Data Analyst LLM failed:", e);
      return { dataAnalysisOutput: "Failed to generate python code." };
    }

    // Step 2: Execute code in E2B Sandbox
    let stdout = "";
    let chartBase64 = "";

    try {
      if (!warmSandbox) {
        console.log("Spinning up NEW E2B Sandbox...");
        warmSandbox = await Sandbox.create({ 
          apiKey: process.env.E2B_API_KEY, 
          timeoutMs: 3600000 // Keep alive for 1 hour 
        });
      } else {
        console.log("Reusing warm E2B Sandbox...");
      }
      
      // Matplotlib/Seaborn is pre-installed in the default E2B code-interpreter image
      const execution = await warmSandbox.runCode(code);
    
    stdout = execution.logs.stdout.join("\n");
    if (execution.logs.stderr.length > 0) {
      console.warn("E2B stderr:", execution.logs.stderr.join("\n"));
    }

    if (execution.results.length > 0) {
      for (const result of execution.results) {
        if (result.png) {
          chartBase64 = `data:image/png;base64,${result.png}`;
          break; // Take the first generated chart
        } else if (result.jpeg) {
          chartBase64 = `data:image/jpeg;base64,${result.jpeg}`;
          break;
        }
      }
    }
    
    if (!stdout && chartBase64) {
      stdout = "Successfully generated data visualization.";
    } else if (!stdout && !chartBase64) {
      stdout = "Analysis ran successfully but generated no outputs.";
    }

  } catch (e) {
    console.error("E2B execution failed:", e);
    stdout = `Execution Error: ${e instanceof Error ? e.message : String(e)}`;
    // If it failed, the sandbox might be dead or unresponsive. Nullify it.
    if (warmSandbox) {
      warmSandbox.kill().catch(() => {});
      warmSandbox = null;
    }
  }

  return { 
    dataAnalysisOutput: stdout,
    dataAnalysisChart: chartBase64
  };
  };

  return Promise.race([executeNode(), timeoutPromise]);
};

// ─────────────────────────────────────────────
// Node 4A: Bull Analyst (Upside Case)
// ─────────────────────────────────────────────
export const bullAnalystNode = async (state: ResearchState): Promise<Partial<ResearchState>> => {
  const llm = getFastLLM();
  const userQuery = state.messages[0];
  const docsText = (state.documents || []).map((d, i) => `[${i + 1}] ${d.pageContent}`).join("\n\n");

  const prompt = new SystemMessage(`You are the BULL ANALYST on a Wall Street research desk. Build a BULLISH investment case in under 450 words.

STRICT RULES:
- Every factual claim MUST cite a source number [1], [2], etc.
- Use precise data: quote exact revenue figures, growth percentages, margins
- Use measured but confident language when data supports it

Structure your analysis with:
## Growth Catalysts
(Revenue trajectory, new products, partnerships, market expansion)
## Competitive Advantages
(Market share, technology moat, customer metrics)
## Upside Scenario
(Best-case outcome if key catalysts play out)

End with:
**Bull Case Summary** — exactly 3 bullet points
**Conviction Level:** HIGH / MEDIUM / LOW (with a percentage, e.g. "HIGH — 80% conviction")

Evidence:
${docsText}`);

  const response = await llm.invoke([prompt, userQuery]);
  return { bullAnalysis: response.content.toString() };
};

// ─────────────────────────────────────────────
// Node 4B: Bear Analyst (Downside Case)
// ─────────────────────────────────────────────
export const bearAnalystNode = async (state: ResearchState): Promise<Partial<ResearchState>> => {
  const llm = getFastLLM();
  const userQuery = state.messages[0];
  const docsText = (state.documents || []).map((d, i) => `[${i + 1}] ${d.pageContent}`).join("\n\n");

  const prompt = new SystemMessage(`You are the BEAR ANALYST on a Wall Street research desk. Build a BEARISH investment case in under 450 words.

STRICT RULES:
- Every factual claim MUST cite a source number [1], [2], etc.
- Quantify every risk with specific numbers (e.g., "margins could compress by X%")
- Do NOT repeat the bull case — focus on what could go WRONG

Structure your analysis with:
## Key Financial Risks
(Revenue sustainability, margin pressure, profitability concerns)
## Operational & Talent Risks
(Scaling challenges, talent retention, customer concentration)
## Regulatory & Market Risks
(Compliance costs, competitive threats, market timing)
## Downside Scenario
(Worst-case outcome if key risks materialize)

End with:
**Bear Case Summary** — exactly 3 bullet points
**Conviction Level:** HIGH / MEDIUM / LOW (with a percentage, e.g. "MEDIUM — 55% conviction")

Evidence:
${docsText}`);

  const response = await llm.invoke([prompt, userQuery]);
  return { bearAnalysis: response.content.toString() };
};

// ─────────────────────────────────────────────
// Node 5: Critic Agent (Self-Correction)
// ─────────────────────────────────────────────
export const criticNode = async (state: ResearchState): Promise<Partial<ResearchState>> => {
  const llm = getFastLLM();

  const prompt = new SystemMessage(`You are the QUALITY ASSURANCE CRITIC on an elite research team.

Score each analysis on these criteria (1-5 each):
1. **Citation Quality** — Are all claims backed by [source] numbers?
2. **Language Discipline** — Does it avoid overconfident words like "certain," "guaranteed," "will"?
3. **Risk Coverage** — Are financial, operational, regulatory, AND talent risks addressed?
4. **Actionability** — Does the summary give clear, specific takeaways?

Format your response as:

### Bull Analysis Score
- Citation: X/5
- Language: X/5
- Coverage: X/5
- Actionability: X/5
- **Total: X/20**

### Bear Analysis Score
- Citation: X/5
- Language: X/5
- Coverage: X/5
- Actionability: X/5
- **Total: X/20**

### Issues Found
[List any specific problems]

### Evidence Strength Assessment
Based on the data available, rate the overall evidence base:
- **STRONG** — enough data to make a confident investment decision
- **MODERATE** — some gaps but sufficient for a preliminary recommendation
- **WEAK** — significant data gaps, more research needed

### Verdict
✅ APPROVED or ⚠️ CAVEATS (with explanation)

## Bull Analysis:
${state.bullAnalysis || "None provided."}

## Bear Analysis:
${state.bearAnalysis || "None provided."}`);

  const response = await llm.invoke([prompt, state.messages[0]]);
  return { criticReview: response.content.toString() };
};

// ─────────────────────────────────────────────
// Node 6: Executive Synthesis (Final Verdict)
// ─────────────────────────────────────────────
export const synthesizeNode = async (state: ResearchState): Promise<Partial<ResearchState>> => {
  const llm = getHeavyLLM();
  const userQuery = state.messages[0];

  const prompt = new SystemMessage(`You are the CHIEF INVESTMENT STRATEGIST at a top-tier hedge fund. Produce a decisive intelligence report.

CRITICAL INSTRUCTION: You MUST commit fully to your verdict. If the evidence leans bullish, say INVEST. If bearish, say SELL. Only use WAIT if the bull and bear cases are genuinely 50/50 with no tiebreaker. Never hedge. Your reputation depends on making a clear call.

REPORT STRUCTURE (use these exact ## headers):

## Executive Summary
2-3 sentences. Lead with the verdict: "We recommend [INVEST/WAIT/SELL] on [Company]." Then state the single most important reason.

## 🟢 Bull Case
The 3-4 strongest bullish arguments with specific numbers (revenue, growth %, margins, market share).

## 🔴 Bear Case
The 3-4 strongest bearish arguments with specific numbers.

## 🔍 Quality Review
Critic scores (X/20 for each side). Note the evidence strength assessment. If evidence is STRONG, this should increase your confidence.

## ⚖️ Final Verdict
State one of: **🟢 INVEST** / **🟡 WAIT** / **🔴 SELL**
Explain in 2-3 sentences WHY you chose this verdict over the alternatives.

## 📊 Confidence Score
State a percentage (0-100%). Guidelines:
- 85-100%: Evidence is overwhelming in one direction
- 70-84%: Strong evidence with minor uncertainties
- 55-69%: Mixed signals, but one side edges out
- Below 55%: Genuinely uncertain (rare — push yourself to decide)

## 📋 Recommended Actions
List exactly 3 specific, time-bound actions (e.g., "Within 30 days, review Q3 earnings for...").

---

RULES:
- Keep total length under 600 words
- Use **bold** for every key metric
- Be DECISIVE — your job is to make the call, not to list pros and cons
- If both analysts score above 15/20, the evidence is strong enough for a confident verdict

## Bull Analyst Report:
${state.bullAnalysis || "No bull analysis."}

## Bear Analyst Report:
${state.bearAnalysis || "No bear analysis."}

## Critic Review:
${state.criticReview || "No critic review."}`);

  const response = await llm.invoke([prompt, userQuery]);
  
  return {
    synthesis: response.content.toString(),
    messages: [new HumanMessage({ content: response.content.toString(), name: "Executive" })]
  };
};
