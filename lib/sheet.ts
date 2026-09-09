export interface FaqItem {
  id: string;
  category: string;
  question: string;
  keywords: string;
  answer: string;
  isActive: boolean;
}

let cache: { data: FaqItem[]; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // cache 60 วิ ตามที่กำหนด — อยู่ได้แค่ใน serverless instance ที่ยัง "warm" เท่านั้น

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { result.push(cur); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

function parseCsv(csv: string): FaqItem[] {
  const lines = csv.trim().split(/\r?\n/);
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1)
    .map((line) => {
      const cols = splitCsvLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => (row[h] = (cols[i] ?? "").trim()));
      return {
        id: row.id ?? "",
        category: row.category ?? "",
        question: row.question ?? "",
        keywords: row.keywords ?? "",
        answer: row.answer ?? "",
        isActive: (row.is_active ?? "TRUE").toUpperCase() !== "FALSE",
      };
    })
    .filter((r) => r.isActive && r.question && r.answer);
}

export async function getFaqList(): Promise<FaqItem[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.data;

  const url = process.env.SHEET_CSV_URL;
  if (!url) throw new Error("SHEET_CSV_URL is not set");

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    if (cache) return cache.data; // ดึงไม่ได้ ใช้ของเก่าไปก่อนดีกว่าไม่มีเลย
    throw new Error(`Fetch sheet failed: ${res.status}`);
  }

  const data = parseCsv(await res.text());
  cache = { data, expiresAt: now + CACHE_TTL_MS };
  return data;
}
