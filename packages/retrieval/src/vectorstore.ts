import { QdrantVectorStore } from "@langchain/qdrant";
import { CohereEmbeddings } from "@langchain/cohere";

export const getVectorStore = async (collectionName: string) => {
  const embeddings = new CohereEmbeddings({
    model: "embed-english-v3.0",
    apiKey: process.env.COHERE_API_KEY,
  });

  const url = process.env.QDRANT_URL || "http://localhost:6333";
  const apiKey = process.env.QDRANT_API_KEY || undefined;

  const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
    url,
    apiKey,
    collectionName,
  });

  return vectorStore;
};

export const initializeCollection = async (collectionName: string) => {
  // If collection doesn't exist, we can create it via rest client or just let QdrantVectorStore handle it via fromTexts
  // For production, we'd use the Qdrant Client to ensure collection parameters
  const { QdrantClient } = await import("@qdrant/js-client-rest");
  const url = process.env.QDRANT_URL || "http://localhost:6333";
  const apiKey = process.env.QDRANT_API_KEY || undefined;
  
  const client = new QdrantClient({ url, apiKey });
  
  const response = await client.getCollections();
  const exists = response.collections.some(c => c.name === collectionName);
  
  if (!exists) {
    await client.createCollection(collectionName, {
      vectors: {
        size: 1024, // Cohere embed-english-v3.0 dimensions
        distance: "Cosine"
      }
    });
  }
};
