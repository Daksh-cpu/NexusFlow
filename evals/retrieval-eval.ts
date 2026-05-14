import { ingestDocuments, retrieveWithSelfCorrection } from "../packages/retrieval/src/index.js";

const company = "NVIDIA";

await ingestDocuments({
  sources: [
    {
      id: "src-1",
      company,
      type: "text",
      title: "Quarterly filing summary",
      content: "Strong data center demand and backlog with expanding margins and robust free cash flow.",
      trustScore: 0.9
    },
    {
      id: "src-2",
      company,
      type: "text",
      title: "Risk memo",
      content: "Export controls and customer concentration remain downside risks with policy uncertainty.",
      trustScore: 0.87
    },
    {
      id: "src-3",
      company,
      type: "text",
      title: "Valuation note",
      content: "Current multiples imply elevated growth expectations compared to peers.",
      trustScore: 0.82
    },
    {
      id: "src-4",
      company,
      type: "text",
      title: "Industry report",
      content: "AI demand remains resilient but cyclical spending volatility can affect quarterly results.",
      trustScore: 0.8
    },
    {
      id: "src-5",
      company,
      type: "text",
      title: "Strategy report",
      content: "Software ecosystem and platform integration create switching costs and pricing power.",
      trustScore: 0.88
    }
  ]
});

const questions = [
  "What are the main upside drivers?",
  "What are top downside risks?",
  "Is valuation stretched versus peers?",
  "What should investors monitor this quarter?",
  "Should we invest now or wait?"
];

for (const question of questions) {
  const result = await retrieveWithSelfCorrection(company, question);
  console.log({
    question,
    relevance: result.relevance,
    attempts: result.attempts,
    citationCount: result.citations.length
  });
}
