import "dotenv/config";
import { HumanMessage } from "@langchain/core/messages";
import { graph } from "@packages/graph";

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error("Please provide a query as the first argument.");
    process.exit(1);
  }

  console.log(`Starting research for: "${query}"...\n`);
  const startTime = Date.now();

  const initialState = {
    messages: [new HumanMessage(query)],
  };

  const stream = await graph.stream(initialState);

  for await (const chunk of stream) {
    for (const [nodeName, stateUpdate] of Object.entries(chunk)) {
      console.log(`=== Node Finished: ${nodeName} ===`);
      const update = stateUpdate as any;
      if (update.queries) {
        console.log(`Generated Queries: \n${update.queries.join("\n")}`);
      }
      if (update.documents) {
        console.log(`Retrieved ${update.documents.length} documents.`);
      }
      if (update.bullAnalysis) {
        console.log(`\n🟢 Bull Analysis:\n${update.bullAnalysis.slice(0, 200)}...`);
      }
      if (update.bearAnalysis) {
        console.log(`\n🔴 Bear Analysis:\n${update.bearAnalysis.slice(0, 200)}...`);
      }
      if (update.criticReview) {
        console.log(`\n🔍 Critic Review:\n${update.criticReview}`);
      }
      if (update.synthesis) {
        console.log(`\n⚡ Final Synthesis:\n${update.synthesis}`);
      }
      console.log("\n");
    }
  }

  console.log(`\n⏱️  Total time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

main().catch(console.error);
