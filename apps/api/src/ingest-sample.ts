import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { initializeCollection, getVectorStore } from "@packages/retrieval";
import { Document } from "@langchain/core/documents";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const collectionName = "research_collection";
  const filePath = path.join(__dirname, "../../../data/nexuscorp_research.txt");

  console.log("--- Starting Sample Ingestion ---");

  // 1. Initialize Qdrant Collection
  console.log(`Initializing collection: ${collectionName}...`);
  await initializeCollection(collectionName);

  // 2. Load and Split Document
  console.log("Reading sample file...");
  const content = fs.readFileSync(filePath, "utf-8");
  
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
  });

  const docs = await splitter.createDocuments([content], [{ source: "nexuscorp_research.txt", company: "NexusCorp" }]);
  console.log(`Split into ${docs.length} chunks.`);

  // 3. Ingest into Vector Store
  console.log("Embedding and uploading to Qdrant (this may take a few seconds)...");
  const vectorStore = await getVectorStore(collectionName);
  await vectorStore.addDocuments(docs);

  console.log("--- Ingestion Complete! ---");
  console.log("You can now run the research agent to ask about NexusCorp.");
}

main().catch(console.error);
