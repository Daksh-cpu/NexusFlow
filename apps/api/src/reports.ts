import fs from "fs";
import path from "path";

const REPORTS_DIR = path.resolve(process.cwd(), "data", "reports");

// Ensure reports directory exists
function ensureDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

export interface SavedReport {
  id: string;
  company: string;
  question: string;
  bullAnalysis: string;
  bearAnalysis: string;
  criticReview: string;
  synthesis: string;
  documentCount: number;
  createdAt: string;
}

export function saveReport(report: SavedReport): void {
  ensureDir();
  const filePath = path.join(REPORTS_DIR, `${report.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");
  console.log(`Report saved: ${filePath}`);
}

export function getReport(id: string): SavedReport | null {
  const filePath = path.join(REPORTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function listReports(): SavedReport[] {
  ensureDir();
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith(".json"));
  
  return files
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), "utf-8")) as SavedReport;
      } catch {
        return null;
      }
    })
    .filter((r): r is SavedReport => r !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function deleteReport(id: string): boolean {
  const filePath = path.join(REPORTS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
