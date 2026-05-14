import { BaseDocumentCompressor } from "@langchain/core/retrievers/document_compressors";
import { Document } from "@langchain/core/documents";
import { RerankerService } from "./reranker.js";
import { VectorStoreRetriever } from "@langchain/core/vectorstores";
import { BaseRetriever, type BaseRetrieverInterface } from "@langchain/core/retrievers";

class CustomRerankerCompressor extends BaseDocumentCompressor {
  private service: RerankerService;
  private topN: number;

  constructor(service: RerankerService, topN: number = 5) {
    super();
    this.service = service;
    this.topN = topN;
  }

  async compressDocuments(
    documents: Document[],
    query: string
  ): Promise<Document[]> {
    return this.service.rerankDocuments(query, documents, this.topN);
  }
}

/**
 * A simple implementation of contextual compression retrieval 
 * that extends BaseRetriever for compatibility with LangChain interfaces.
 */
export class SimpleCompressionRetriever extends BaseRetriever {
  lc_namespace = ["packages", "retrieval"];
  private baseRetriever: VectorStoreRetriever;
  private compressor: CustomRerankerCompressor;

  constructor(baseRetriever: VectorStoreRetriever, compressor: CustomRerankerCompressor) {
    super();
    this.baseRetriever = baseRetriever;
    this.compressor = compressor;
  }

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const docs = await this.baseRetriever.invoke(query);
    return this.compressor.compressDocuments(docs, query);
  }
}

export const createRetrievalPipeline = (
  baseRetriever: VectorStoreRetriever,
  topN: number = 5
) => {
  const service = new RerankerService();
  const compressor = new CustomRerankerCompressor(service, topN);

  return new SimpleCompressionRetriever(baseRetriever, compressor);
};
