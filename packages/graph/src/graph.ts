import { StateGraph, START, END } from "@langchain/langgraph";
import { ResearchState, researchStateSchema } from "./state.js";
import {
  generateQueriesNode,
  retrieveDocumentsNode,
  bullAnalystNode,
  bearAnalystNode,
  criticNode,
  synthesizeNode
} from "./nodes.js";

const builder = new StateGraph<ResearchState>({ channels: researchStateSchema })
  // Register all nodes
  .addNode("generate_queries", generateQueriesNode)
  .addNode("retrieve_documents", retrieveDocumentsNode)
  .addNode("bull_analyst", bullAnalystNode)
  .addNode("bear_analyst", bearAnalystNode)
  .addNode("critic", criticNode)
  .addNode("synthesize", synthesizeNode)

  // Linear: START → queries → retrieval
  .addEdge(START, "generate_queries")
  .addEdge("generate_queries", "retrieve_documents")

  // Fan-out: retrieval → BOTH analysts in parallel
  .addEdge("retrieve_documents", "bull_analyst")
  .addEdge("retrieve_documents", "bear_analyst")

  // Fan-in: BOTH analysts → critic
  .addEdge("bull_analyst", "critic")
  .addEdge("bear_analyst", "critic")

  // Critic → Executive Synthesis → END
  .addEdge("critic", "synthesize")
  .addEdge("synthesize", END);

export const graph = builder.compile();
