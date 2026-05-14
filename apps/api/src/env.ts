import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try multiple possible paths for the monorepo root
const pathsToTry = [
  path.resolve(__dirname, "../../../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env")
];

let loaded = false;
for (const p of pathsToTry) {
  if (fs.existsSync(p)) {
    console.log("Found .env at:", p);
    dotenv.config({ path: p });
    loaded = true;
    break;
  }
}

if (!loaded) {
  console.error("CRITICAL: No .env file found in any expected location!");
}

if (!process.env.COHERE_API_KEY) {
  console.error("CRITICAL: COHERE_API_KEY is still missing from process.env!");
} else {
  console.log("COHERE_API_KEY loaded successfully (starts with:", process.env.COHERE_API_KEY.substring(0, 4) + "...)");
}
