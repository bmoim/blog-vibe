import express from "express";
import { appendActivity, clearActivities, listActivities } from "./activity-history.js";
import { listQueryResults } from "./query-results.js";
import {
  getBrowserVaultBundle,
  getPersistentDataStatus,
  restoreBrowserVaultBundle,
  syncPersistentDataNow
} from "./persistent-data.js";

const router = express.Router();

async function readRawJson(req, maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("브라우저 백업 데이터가 너무 큽니다. 25MB 이하만 자동 복원할 수 있습니다."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("브라우저 백업 데이터 형식이 올바르지 않습니다."), { status: 400 }); }
}

router.get("/persistence/status", async (req, res) => {
  res.json(await getPersistentDataStatus());
});

router.get("/persistence/export", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ bundle: await getBrowserVaultBundle(), status: await getPersistentDataStatus() });
});

router.post("/persistence/import", async (req, res) => {
  const payload = req.is("application/octet-stream") ? await readRawJson(req) : req.body;
  const restored = await restoreBrowserVaultBundle(payload?.bundle);
  if (!restored) return res.status(400).json({ error: "복원할 데이터 형식이 올바르지 않습니다." });
  res.json({ ok: true, status: await getPersistentDataStatus() });
});

router.post("/persistence/sync", async (req, res) => {
  const synced = await syncPersistentDataNow();
  res.json({ ok: true, synced, status: await getPersistentDataStatus() });
});

router.get("/history", async (req, res) => {
  const records = await listActivities({
    limit: req.query.limit,
    type: String(req.query.type || ""),
    search: String(req.query.search || "")
  });
  res.json({ records, status: await getPersistentDataStatus() });
});

router.get("/history/results", async (req, res) => {
  const results = await listQueryResults({
    limit: req.query.limit,
    type: String(req.query.type || ""),
    search: String(req.query.search || "")
  });
  res.json({ results, status: await getPersistentDataStatus() });
});

router.post("/history", async (req, res) => {
  res.json({ record: await appendActivity(req.body || {}) });
});

router.delete("/history", async (req, res) => {
  await clearActivities();
  await syncPersistentDataNow();
  res.json({ ok: true });
});

export function createPersistenceRouter() {
  return router;
}
