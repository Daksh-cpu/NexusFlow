import type { Citation } from "@packages/shared";

export const researcherAgent = (question: string, snippets: string[]) => ({
  summary: `Collected ${snippets.length} evidence snippets for: ${question}`,
  evidence: snippets.map((s, i) => `Evidence ${i + 1}: ${s.slice(0, 180)}`)
});

export const analystAgent = (question: string, evidence: string[]) => ({
  question,
  bullCase: [
    "Demand momentum and platform lock-in support potential upside.",
    "Strategic product position can sustain medium-term growth."
  ],
  bearCase: [
    "Valuation sensitivity may cap returns if growth normalizes.",
    "Policy, supply, or competition shocks can degrade outlook."
  ],
  risks: [
    "Margin compression risk",
    "Execution risk on new product cycles",
    "Macro and regulatory risk"
  ],
  draft: `Built a balanced bull/bear thesis from ${evidence.length} evidence items.`
});

export const criticAgent = (draft: string, citations: Citation[]) => {
  const unsupportedClaims: string[] = [];
  if (citations.length < 2) unsupportedClaims.push("Not enough cited evidence.");
  const biasFlags = draft.includes("certain") ? ["Overconfident phrasing"] : [];
  return {
    unsupportedClaims,
    biasFlags,
    requiredFixes: unsupportedClaims.length ? ["Collect stronger evidence before recommendation."] : [],
    approvalStatus: unsupportedClaims.length ? "needs_revision" : "approved"
  };
};

export const executiveAgent = (input: {
  company: string;
  question: string;
  bullCase: string[];
  bearCase: string[];
  risks: string[];
  citations: Citation[];
}) => ({
  company: input.company,
  question: input.question,
  decision: (input.citations.length >= 2 ? "Wait" : "Sell") as "Invest" | "Wait" | "Sell",
  confidence: input.citations.length >= 2 ? 0.68 : 0.42,
  bullCase: input.bullCase,
  bearCase: input.bearCase,
  risks: input.risks,
  nextActions: [
    "Monitor next earnings and guidance update.",
    "Track valuation spread against peers.",
    "Re-run analysis with latest filings."
  ],
  citations: input.citations
});
