import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { dataDirectory } from "./storage.js";

const JOBS_FILE = path.join(dataDirectory, "generation-jobs.json");
const MAX_JOBS = 80;
let saveQueue = Promise.resolve();

async function readJobs() {
  try {
    const value = JSON.parse(await fs.readFile(JOBS_FILE, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeJobs(records) {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temp = `${JOBS_FILE}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(records, null, 2), "utf8");
  await fs.rename(temp, JOBS_FILE);
}

function serializableJob(job) {
  const { workerActive, heartbeatTimer, ...record } = job;
  return record;
}

export async function loadGenerationJobs() {
  const records = await readJobs();
  return new Map(records.map((job) => [job.id, job]));
}

export function persistGenerationJobs(jobs) {
  const records = [...jobs.values()]
    .map(serializableJob)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, MAX_JOBS);
  saveQueue = saveQueue.catch(() => null).then(() => writeJobs(records));
  return saveQueue;
}

export async function flushGenerationJobs(jobs) {
  await persistGenerationJobs(jobs);
  await saveQueue.catch(() => null);
}
