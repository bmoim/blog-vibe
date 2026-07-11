import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { dataDirectory } from "./storage.js";

const ACTIVITY_FILE = path.join(dataDirectory, "activity-history.json");
const MAX_RECORDS = 3000;

async function readActivities() {
  try {
    const value = JSON.parse(await fs.readFile(ACTIVITY_FILE, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeActivities(records) {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temp = `${ACTIVITY_FILE}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(records, null, 2), "utf8");
  await fs.rename(temp, ACTIVITY_FILE);
}

function cleanMetadata(value, depth = 0) {
  if (depth > 3 || value == null) return value == null ? null : String(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => cleanMetadata(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 30)) {
      if (/token|secret|password|oauth|authorization|cookie/i.test(key)) continue;
      output[key] = cleanMetadata(item, depth + 1);
    }
    return output;
  }
  if (typeof value === "string") return value.slice(0, 1500);
  return value;
}

export async function appendActivity({ type, title, query = "", metadata = {}, status = "completed" }) {
  const records = await readActivities();
  const record = {
    id: crypto.randomUUID(),
    type: String(type || "activity").slice(0, 80),
    title: String(title || "기록").slice(0, 300),
    query: String(query || "").slice(0, 1500),
    metadata: cleanMetadata(metadata),
    status: String(status || "completed").slice(0, 30),
    createdAt: new Date().toISOString()
  };
  records.push(record);
  await writeActivities(records.slice(-MAX_RECORDS));
  return record;
}

export async function listActivities({ limit = 200, type = "", search = "" } = {}) {
  let records = await readActivities();
  if (type) records = records.filter((item) => item.type === type);
  if (search) {
    const needle = String(search).toLowerCase();
    records = records.filter((item) => `${item.title} ${item.query} ${JSON.stringify(item.metadata)}`.toLowerCase().includes(needle));
  }
  return records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, Math.max(1, Math.min(1000, Number(limit || 200))));
}

export async function clearActivities() {
  await writeActivities([]);
}
