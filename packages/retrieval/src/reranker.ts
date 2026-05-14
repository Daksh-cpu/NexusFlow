import { CohereClient } from "cohere-ai";
import { Document } from "@langchain/core/documents";

export interface RerankerProvider {
  rerank(query: string, documents: Document[], topN?: number): Promise<Document[]>;
}

export class CohereReranker implements RerankerProvider {
  private client: CohereClient;
  private model: string;

  constructor(apiKey: string) {
    this.client = new CohereClient({ token: apiKey });
    this.model = process.env.COHERE_RERANK_MODEL || "rerank-english-v3.0";
  }

  async rerank(query: string, documents: Document[], topN: number = 5): Promise<Document[]> {
    try {
      const response = await this.client.rerank({
        model: this.model,
        query,
        documents: documents.map((doc) => doc.pageContent),
        topN,
      });

      const results = response.results || [];
      return results.map((result) => {
        const doc = documents[result.index];
        doc.metadata.relevanceScore = result.relevanceScore;
        return doc;
      });
    } catch (error) {
      console.error(`Cohere Rerank API error (Model: ${this.model}):`, (error as any).message);
      throw error;
    }
  }
}

/**
 * A local, zero-dependency reranker that uses string overlap and basic 
 * frequency analysis. This serves as the ultimate safety net.
 */
export class SimpleSimilarityReranker implements RerankerProvider {
  async rerank(query: string, documents: Document[], topN: number = 5): Promise<Document[]> {
    const queryTerms = new Set(query.toLowerCase().split(/\s+/));
    
    const scoredDocs = documents.map(doc => {
      const content = doc.pageContent.toLowerCase();
      let score = 0;
      
      // Basic term frequency overlap
      queryTerms.forEach(term => {
        if (content.includes(term)) {
          score += 1;
          // Bonus for exact word matches vs substring
          const regex = new RegExp(`\\b${term}\\b`, 'g');
          const matches = content.match(regex);
          if (matches) score += matches.length * 0.5;
        }
      });
      
      // Normalize by content length to avoid favoring long docs too much
      const normalizedScore = score / (Math.log(content.length) + 1);
      doc.metadata.relevanceScore = normalizedScore;
      return doc;
    });

    return scoredDocs
      .sort((a, b) => (b.metadata.relevanceScore || 0) - (a.metadata.relevanceScore || 0))
      .slice(0, topN);
  }
}

export class LocalReranker implements RerankerProvider {
  private endpoint: string;
  private model: string;

  constructor(endpoint: string, model: string) {
    this.endpoint = endpoint;
    this.model = model;
  }

  async rerank(query: string, documents: Document[], topN: number = 5): Promise<Document[]> {
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, texts: documents.map(d => d.pageContent), model: this.model })
      });
      
      if (!response.ok) throw new Error(`Local reranker failed: ${response.statusText}`);
      
      const data = await response.json();
      return data.map((res: any, index: number) => {
         const doc = documents[index];
         doc.metadata.relevanceScore = res.score;
         return doc;
      }).sort((a: Document, b: Document) => (b.metadata.relevanceScore || 0) - (a.metadata.relevanceScore || 0))
      .slice(0, topN);
    } catch (e) {
      throw e;
    }
  }
}

export class RerankerService {
  private cohere?: CohereReranker;
  private bge?: LocalReranker;
  private minilm?: LocalReranker;
  private fallback: SimpleSimilarityReranker;

  constructor() {
    this.fallback = new SimpleSimilarityReranker();

    if (process.env.COHERE_API_KEY) {
      this.cohere = new CohereReranker(process.env.COHERE_API_KEY);
      console.log("Reranker Service: Cohere initialized as primary.");
    } else {
      console.warn("Reranker Service: COHERE_API_KEY missing. Cohere will be skipped.");
    }
    
    if (process.env.BGE_RERANKER_URL) {
      this.bge = new LocalReranker(process.env.BGE_RERANKER_URL, "bge-reranker-large");
    }
    
    if (process.env.MINILM_RERANKER_URL) {
      this.minilm = new LocalReranker(process.env.MINILM_RERANKER_URL, "ms-marco-MiniLM-L-6-v2");
    }
  }

  async rerankDocuments(query: string, documents: Document[], topN: number = 5): Promise<Document[]> {
    if (documents.length === 0) return [];

    // 1. Try Cohere (Primary)
    if (this.cohere) {
      try {
        return await this.cohere.rerank(query, documents, topN);
      } catch (e) {
        console.warn("Cohere reranker failed, trying local fallbacks...");
      }
    }

    // 2. Try Local Model Servers (BGE/MiniLM)
    if (this.bge) {
       try {
         return await this.bge.rerank(query, documents, topN);
       } catch (e) {}
    }

    if (this.minilm) {
      try {
         return await this.minilm.rerank(query, documents, topN);
      } catch (e) {}
    }

    // 3. Ultimate Fallback (Guaranteed to work)
    console.log("Using Local Similarity Reranker (Offline Fallback).");
    return await this.fallback.rerank(query, documents, topN);
  }
}
