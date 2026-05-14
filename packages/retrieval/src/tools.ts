import { TavilySearch } from "@langchain/tavily";

export const getWebSearchTool = (apiKey?: string) => {
  const key = apiKey || process.env.TAVILY_API_KEY;
  if (!key) {
    console.warn("TAVILY_API_KEY not found in process.env. Web search will be disabled.");
    return null;
  }
  console.log("Web search tool initialized successfully with API key.");
  
  return new TavilySearch({
    tavilyApiKey: key,
    maxResults: 5,
  });
};
