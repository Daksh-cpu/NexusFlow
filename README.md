# 🧠 NexusFlow — Autonomous Multi-Agent Research Platform

> An elite investment research system powered by adversarial AI agents that **debate**, **argue**, and **decide** — so you don't have to.

[![Architecture](https://img.shields.io/badge/Architecture-Multi--Agent_Debate-ff8c00?style=for-the-badge)](/)
[![LangGraph](https://img.shields.io/badge/Orchestration-LangGraph-blue?style=for-the-badge)](https://github.com/langchain-ai/langgraphjs)
[![Cohere](https://img.shields.io/badge/LLM-Command_R+-purple?style=for-the-badge)](https://cohere.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](/)

---

## 🎯 What is NexusFlow?

NexusFlow is a **production-grade multi-agent research platform** that uses an adversarial debate architecture to produce balanced, evidence-backed investment analysis. Instead of a single AI writing a report, NexusFlow deploys specialized agents that argue opposing viewpoints before an Executive agent delivers the final verdict.

### The 6-Agent Debate Architecture

```
┌─────────────────┐
│  User Question   │
└────────┬────────┘
         │
   ┌─────▼─────┐
   │ 🔍 Query   │  Generates 3 targeted research angles
   │   Engine   │
   └─────┬─────┘
         │
   ┌─────▼─────┐
   │ 📡 Hybrid  │  Qdrant (Local) + Tavily (Web)
   │  Search    │  → 3-Tier Reranking Pipeline
   └──┬─────┬──┘
      │     │
 ┌────▼──┐ ┌▼────┐    ← Parallel Execution
 │ 🟢    │ │ 🔴  │
 │ BULL  │ │BEAR │    Builds upside case & investigates risks
 │Analyst│ │Analyst│
 └───┬───┘ └──┬──┘
     │        │
   ┌─▼────────▼─┐
   │ ⚖️ Quality  │  Scores analysis /20 (Citations, Logic, Risks)
   │   Critic   │  Enforces strict self-correction
   └─────┬──────┘
         │
   ┌─────▼───────┐
   │ ⚡ Executive │  Final Verdict: INVEST / WAIT / SELL
   │ Synthesizer │  + Confidence Score + Action Plan
   └─────────────┘
```

---

## ✨ v1.0.0 Features

*   **Adversarial Debate**: Bull and Bear analysts argue the data in parallel to eliminate AI bias.
*   **Self-Correction System**: The Critic agent mathematically scores the analysis, forcing agents to back up claims with citations.
*   **Research Ledger**: All reports are automatically cached locally as JSON. Re-requesting the same company streams instantly, bypassing the 40s LLM execution time.
*   **Premium Glassmorphism UI**: 
    *   Live-streaming Agent Thought sidebar
    *   Visual Pipeline Execution Tracker
    *   Dynamic pulse animations and professional markdown rendering
*   **Bulletproof Retrieval**: Gracefully falls back through 3 tiers of rerankers and hybrid search methods to guarantee a result even if services go offline.

---

## 🏗️ Monorepo Structure

```
├── apps/
│   ├── api/          # Express API with SSE streaming
│   └── web/          # Next.js 14 streaming UI
├── packages/
│   ├── agents/       # Agent logic (Researcher, Analyst, Critic, Executive)
│   ├── graph/        # LangGraph orchestration (debate flow)
│   ├── retrieval/    # Hybrid retrieval + reranking + web search
│   └── shared/       # Zod schemas and typed contracts
├── data/             # Sample research documents
├── docker-compose.yml # Qdrant vector database
└── render.yaml       # Production deployment config
```

---

## ⚡ Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Add your COHERE_API_KEY and TAVILY_API_KEY

# 3. Start Qdrant (requires Docker)
docker-compose up -d

# 4. Ingest sample data
npx tsx apps/api/src/ingest-sample.ts

# 5. Start the API
npm run dev:api

# 6. Start the Web UI
npm run dev:web

# 7. Open http://localhost:3000
```

---

## 🛡️ Resilience Features

NexusFlow is designed to **never break**, even when services are unavailable:

| Scenario | Behavior |
|---|---|
| Qdrant is offline | Proceeds with web search only |
| Tavily key missing | Proceeds with local documents only |
| Cohere reranker fails | Falls back to local similarity reranker |
| All rerankers fail | Returns original documents (no crash) |

---

## 🔧 Tech Stack

| Layer | Technology |
|---|---|
| **Orchestration** | LangGraph (parallel fan-out/fan-in) |
| **LLM** | Cohere Command R+ |
| **Embeddings** | Cohere embed-english-v3.0 |
| **Vector DB** | Qdrant |
| **Web Search** | Tavily |
| **Reranking** | Cohere Rerank → Local Fallback |
| **Frontend** | Next.js 14 + Framer Motion |
| **Backend** | Express + Server-Sent Events |
| **Validation** | Zod |

---

## 🌐 Deployment (100% Free)

| Service | Provider | Cost |
|---|---|---|
| Frontend | Vercel (Hobby) | $0/mo |
| Backend | Render.com (Free) | $0/mo |
| Vector DB | Qdrant Cloud (Free) | $0/mo |
| LLM | Cohere (Trial) | $0/mo |
| Web Search | Tavily (Free) | $0/mo |

---

## 📄 License

MIT © Daksh
