import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Pool } from "pg";
import { dataDirectory, generatedDirectory } from "./storage.js";

const APP_KEY = "blogger-ai-publisher-primary";
const DATA_FILES = [
  "drafts.json",
  "usage.json",
  "growth-settings.json",
  "growth-schedules.json",
  "draft-versions.json",
  "growth-monitor.json",
  "topic-plans.json",
  "activity-history.json",
  "query-results.json",
  "generation-jobs.json"
];

let pool = null;
let initialized = false;
let syncing = false;
let lastError = null;
let lastSyncedAt = null;
let dataWatcher = null;
let imageWatcher = null;
let dataDebounce = null;
const imageDebounces = new Map();

async function ensureDirectories() {
  await fs.mkdir(dataDirectory, { recursive: true });
  await fs.mkdir(generatedDirectory, { recursive: true });
}

async function readJsonOptional(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temp, file);
}

async function localLatestMtime() {
  let latest = 0;
  for (const name of DATA_FILES) {
    try {
      const stat = await fs.stat(path.join(dataDirectory, name));
      latest = Math.max(latest, stat.mtimeMs);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return latest;
}

async function buildPayload() {
  const files = {};
  for (const name of DATA_FILES) {
    const value = await readJsonOptional(path.join(dataDirectory, name));
    if (value !== null) files[name] = value;
  }
  return {
    format: "blogger-ai-persistent-snapshot",
    version: 1,
    savedAt: new Date().toISOString(),
    files
  };
}

async function restorePayload(payload) {
  if (!payload || payload.format !== "blogger-ai-persistent-snapshot" || Number(payload.version) !== 1) return false;
  for (const [name, value] of Object.entries(payload.files || {})) {
    if (!DATA_FILES.includes(name)) continue;
    await writeJsonAtomic(path.join(dataDirectory, name), value);
  }
  return true;
}

function referencedImageNames(payload) {
  const drafts = Array.isArray(payload?.files?.["drafts.json"]) ? payload.files["drafts.json"] : [];
  const names = new Set();
  for (const draft of drafts) {
    for (const image of draft.images || []) {
      if (image?.filename) names.add(path.basename(String(image.filename)));
    }
  }
  return [...names];
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blogger_ai_snapshots (
      app_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blogger_ai_files (
      filename TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      data BYTEA NOT NULL,
      size_bytes BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function restoreImages(payload) {
  if (!pool) return 0;
  const names = referencedImageNames(payload);
  if (!names.length) return 0;
  const result = await pool.query(
    "SELECT filename, data FROM blogger_ai_files WHERE filename = ANY($1::text[])",
    [names]
  );
  let restored = 0;
  for (const row of result.rows) {
    const file = path.join(generatedDirectory, path.basename(row.filename));
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, row.data);
      restored += 1;
    }
  }
  return restored;
}

async function uploadImage(filename) {
  if (!pool || !filename) return;
  const clean = path.basename(filename);
  const file = path.join(generatedDirectory, clean);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      await pool.query("DELETE FROM blogger_ai_files WHERE filename = $1", [clean]).catch(() => null);
      return;
    }
    throw error;
  }
  if (!stat.isFile() || stat.size > 15 * 1024 * 1024) return;
  const extension = path.extname(clean).toLowerCase();
  const contentType = extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/webp";
  const data = await fs.readFile(file);
  await pool.query(
    `INSERT INTO blogger_ai_files(filename, content_type, data, size_bytes, updated_at)
     VALUES($1, $2, $3, $4, NOW())
     ON CONFLICT(filename) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data, size_bytes = EXCLUDED.size_bytes, updated_at = NOW()`,
    [clean, contentType, data, stat.size]
  );
}

async function uploadExistingImages() {
  if (!pool) return;
  let names = [];
  try { names = await fs.readdir(generatedDirectory); } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const name of names.slice(-500)) await uploadImage(name);
}

export async function syncPersistentDataNow() {
  if (!pool || syncing) return false;
  syncing = true;
  try {
    const payload = await buildPayload();
    await pool.query(
      `INSERT INTO blogger_ai_snapshots(app_key, payload, updated_at)
       VALUES($1, $2::jsonb, NOW())
       ON CONFLICT(app_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [APP_KEY, JSON.stringify(payload)]
    );
    lastSyncedAt = new Date().toISOString();
    lastError = null;
    return true;
  } catch (error) {
    lastError = error.message;
    console.error("Persistent data sync failed:", error);
    return false;
  } finally {
    syncing = false;
  }
}

function scheduleDataSync() {
  clearTimeout(dataDebounce);
  dataDebounce = setTimeout(() => syncPersistentDataNow(), 1200);
}

function scheduleImageSync(filename) {
  if (!filename) return;
  clearTimeout(imageDebounces.get(filename));
  imageDebounces.set(filename, setTimeout(async () => {
    imageDebounces.delete(filename);
    try { await uploadImage(filename); }
    catch (error) { lastError = error.message; console.error("Persistent image sync failed:", error); }
  }, 1000));
}

export async function initializePersistentData() {
  if (initialized) return getPersistentDataStatus();
  initialized = true;
  await ensureDirectories();
  if (!process.env.DATABASE_URL) return getPersistentDataStatus();

  try {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
    await pool.query("SELECT 1");
    await createTables();

    const result = await pool.query("SELECT payload, updated_at FROM blogger_ai_snapshots WHERE app_key = $1", [APP_KEY]);
    const row = result.rows[0];
    if (row?.payload) {
      const databaseTime = new Date(row.updated_at).getTime();
      const localTime = await localLatestMtime();
      if (!localTime || databaseTime >= localTime - 2000) await restorePayload(row.payload);
      await restoreImages(row.payload);
      lastSyncedAt = new Date(row.updated_at).toISOString();
    } else {
      await syncPersistentDataNow();
      await uploadExistingImages();
    }
    lastError = null;
  } catch (error) {
    lastError = error.message;
    console.error("Persistent database initialization failed:", error);
    try { await pool?.end(); } catch {}
    pool = null;
  }
  return getPersistentDataStatus();
}

export async function startPersistentDataWatchers() {
  await ensureDirectories();
  if (!pool || dataWatcher || imageWatcher) return;
  dataWatcher = fsSync.watch(dataDirectory, { persistent: false }, (event, filename) => {
    if (filename && DATA_FILES.includes(String(filename))) scheduleDataSync();
  });
  imageWatcher = fsSync.watch(generatedDirectory, { persistent: false }, (event, filename) => scheduleImageSync(String(filename || "")));
  setInterval(() => syncPersistentDataNow(), 1000 * 60 * 5).unref();
}

export async function getBrowserVaultBundle() {
  return buildPayload();
}

export async function restoreBrowserVaultBundle(payload) {
  const restored = await restorePayload(payload);
  if (restored) await syncPersistentDataNow();
  return restored;
}

async function dataCounts() {
  const drafts = await readJsonOptional(path.join(dataDirectory, "drafts.json"));
  const plans = await readJsonOptional(path.join(dataDirectory, "topic-plans.json"));
  const activities = await readJsonOptional(path.join(dataDirectory, "activity-history.json"));
  const queryResults = await readJsonOptional(path.join(dataDirectory, "query-results.json"));
  const versions = await readJsonOptional(path.join(dataDirectory, "draft-versions.json"));
  const generationJobs = await readJsonOptional(path.join(dataDirectory, "generation-jobs.json"));
  return {
    drafts: Array.isArray(drafts) ? drafts.length : 0,
    topicPlans: Array.isArray(plans) ? plans.length : 0,
    activities: Array.isArray(activities) ? activities.length : 0,
    queryResults: Array.isArray(queryResults) ? queryResults.length : 0,
    versions: Array.isArray(versions) ? versions.length : 0,
    generationJobs: Array.isArray(generationJobs) ? generationJobs.length : 0
  };
}

export async function getPersistentDataStatus() {
  const counts = await dataCounts();
  return {
    mode: pool ? "postgres" : "browser-vault",
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseConnected: Boolean(pool),
    lastSyncedAt,
    lastError,
    counts,
    totalRecords: Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0)
  };
}

export async function closePersistentData() {
  try { dataWatcher?.close(); } catch {}
  try { imageWatcher?.close(); } catch {}
  await syncPersistentDataNow();
  try { await pool?.end(); } catch {}
  pool = null;
}
