import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { dataDirectory } from "./storage.js";

const RESULTS_FILE = path.join(dataDirectory, "query-results.json");
const MAX_RESULTS = 400;
let writeQueue = Promise.resolve();

async function readResults() {
  try {
    const value = JSON.parse(await fs.readFile(RESULTS_FILE, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeResults(records) {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temp = `${RESULTS_FILE}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(records, null, 2), "utf8");
  await fs.rename(temp, RESULTS_FILE);
}

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return "[depth-limited]";
  if (Array.isArray(value)) return value.slice(0, 150).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 120)) {
      if (/token|secret|password|oauth|authorization|cookie|clientsecret/i.test(key)) continue;
      output[key] = sanitize(item, depth + 1);
    }
    return output;
  }
  if (typeof value === "string") return value.slice(0, 10000);
  return value;
}

function trimRecord(record) {
  const json = JSON.stringify(record);
  if (Buffer.byteLength(json, "utf8") <= 750 * 1024) return record;
  return {
    ...record,
    result: {
      truncated: true,
      summary: "조회 결과가 커서 핵심 메타데이터만 저장했습니다.",
      keys: Object.keys(record.result || {}).slice(0, 80)
    }
  };
}

export function saveQueryResult({ type, title, path: requestPath, query = "", result }) {
  const record = trimRecord({
    id: crypto.randomUUID(),
    type: String(type || "query-result").slice(0, 100),
    title: String(title || "조회 결과").slice(0, 300),
    path: String(requestPath || "").slice(0, 500),
    query: String(query || "").slice(0, 2000),
    result: sanitize(result),
    createdAt: new Date().toISOString()
  });
  writeQueue = writeQueue.catch(() => null).then(async () => {
    const records = await readResults();
    records.push(record);
    await writeResults(records.slice(-MAX_RESULTS));
    return record;
  });
  return writeQueue;
}

export async function listQueryResults({ limit = 100, type = "", search = "" } = {}) {
  await writeQueue.catch(() => null);
  let records = await readResults();
  if (type) records = records.filter((item) => item.type === type);
  if (search) {
    const needle = String(search).toLowerCase();
    records = records.filter((item) => `${item.title} ${item.query} ${JSON.stringify(item.result)}`.toLowerCase().includes(needle));
  }
  return records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, Math.max(1, Math.min(500, Number(limit || 100))));
}

const CAPTURE_RULES = [
  { method: "GET", pattern: /^\/dashboard$/, type: "analytics-dashboard", title: "검색·방문·수익 대시보드 결과" },
  { method: "GET", pattern: /^\/monitor$/, type: "freshness-monitor", title: "업데이트 필요 글 조회 결과" },
  { method: "POST", pattern: /^\/drafts\/[^/]+\/freshness-audit$/, type: "freshness-audit", title: "최신 정보 정밀 검수 결과" },
  { method: "GET", pattern: /^\/drafts\/[^/]+\/quality$/, type: "quality-audit", title: "발행 전 품질 검사 결과" },
  { method: "GET", pattern: /^\/drafts\/[^/]+\/cannibalization$/, type: "cannibalization", title: "중복 키워드 검사 결과" },
  { method: "GET", pattern: /^\/drafts\/[^/]+\/internal-links$/, type: "internal-links", title: "내부링크 추천 결과" },
  { method: "POST", pattern: /^\/drafts\/[^/]+\/variants$/, type: "content-variants", title: "제목·썸네일 개선안" },
  { method: "GET", pattern: /^\/drafts\/[^/]+\/index-inspection$/, type: "index-inspection", title: "Google 색인 상태 결과" },
  { method: "GET", pattern: /^\/drafts\/[^/]+\/link-health$/, type: "link-health", title: "깨진 링크 점검 결과" },
  { method: "POST", pattern: /^\/topics\/generate$/, type: "topic-plan-result", title: "한 달 주제 발굴 결과" }
];

export function queryResultCaptureMiddleware(req, res, next) {
  const rule = CAPTURE_RULES.find((item) => item.method === req.method && item.pattern.test(req.path));
  if (!rule) return next();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 400) {
      saveQueryResult({
        type: rule.type,
        title: rule.title,
        path: req.originalUrl || req.path,
        query: req.body?.topic || req.body?.draftId || req.params?.id || req.query?.search || "",
        result: body
      }).catch((error) => console.error("Query result history write failed:", error));
    }
    return originalJson(body);
  };
  next();
}
