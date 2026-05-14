import { BaseMessage } from "@langchain/core/messages";
import { Document } from "@langchain/core/documents";
import { StateGraphArgs } from "@langchain/langgraph";

export interface ResearchState {
  messages: BaseMessage[];
  queries: string[];
  documents: Document[];
  bullAnalysis: string;
  bearAnalysis: string;
  criticReview: string;
  synthesis: string;
  reportId: string;
}

export const researchStateSchema: StateGraphArgs<ResearchState>["channels"] = {
  messages: {
    value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
    default: () => [],
  },
  queries: {
    value: (x: string[], y: string[]) => x.concat(y),
    default: () => [],
  },
  documents: {
    value: (x: Document[], y: Document[]) => x.concat(y),
    default: () => [],
  },
  bullAnalysis: {
    value: (_x: string, y: string) => y,
    default: () => "",
  },
  bearAnalysis: {
    value: (_x: string, y: string) => y,
    default: () => "",
  },
  criticReview: {
    value: (_x: string, y: string) => y,
    default: () => "",
  },
  synthesis: {
    value: (_x: string, y: string) => y,
    default: () => "",
  },
  reportId: {
    value: (_x: string, y: string) => y,
    default: () => "",
  },
};
