import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { dataDirectory, generatedDirectory } from "./storage.js";

const router = express.Router();
const DATA_FILES = [
  "drafts.json",
  "growth-settings.json",
  "growth-schedules.json",
  "draft-versions.json",
  "growth-monitor.json",
  "topic-plans.json"
];

async function readOptional(file) {
  try { return await fs.readFile(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function writeAtomic(file, buffer) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, buffer);
  await fs.rename(temp, file);
}

function safeFilename(value) {
  const name = path.basename(String(value || ""));
  if (!name || name === "." || name === "..") throw new Error("올바르지 않은 백업 파일명입니다.");
  return name;
}

async function createBundle() {
  const files = {};
  for (const name of DATA_FILES) {
    const data = await readOptional(path.join(dataDirectory, name));
    if (data) files[name] = data.toString("base64");
  }

  const images = {};
  try {
    const names = await fs.readdir(generatedDirectory);
    for (const rawName of names.slice(0, 500)) {
      const name = safeFilename(rawName);
      const full = path.join(generatedDirectory, name);
      const stat = await fs.stat(full);
      if (!stat.isFile() || stat.size > 12 * 1024 * 1024) continue;
      images[name] = (await fs.readFile(full)).toString("base64");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return {
    format: "blogger-ai-publisher-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    files,
    images
  };
}

async function readRawJson(req, maxBytes = 120 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("백업 파일이 너무 큽니다. 120MB 이하 파일만 복원할 수 있습니다."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("백업 JSON 형식이 올바르지 않습니다."), { status: 400 }); }
}

router.get("/backup/export", async (req, res) => {
  const bundle = await createBundle();
  const filename = `blogger-ai-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.set("Cache-Control", "no-store");
  res.send(JSON.stringify(bundle));
});

router.post("/backup/import", async (req, res) => {
  const bundle = await readRawJson(req);
  if (bundle?.format !== "blogger-ai-publisher-backup" || Number(bundle.version) !== 1) {
    return res.status(400).json({ error: "이 프로그램에서 만든 백업 파일이 아닙니다." });
  }

  const restoredFiles = [];
  for (const [rawName, encoded] of Object.entries(bundle.files || {})) {
    const name = safeFilename(rawName);
    if (!DATA_FILES.includes(name)) continue;
    await writeAtomic(path.join(dataDirectory, name), Buffer.from(String(encoded), "base64"));
    restoredFiles.push(name);
  }

  const restoredImages = [];
  for (const [rawName, encoded] of Object.entries(bundle.images || {})) {
    const name = safeFilename(rawName);
    await writeAtomic(path.join(generatedDirectory, name), Buffer.from(String(encoded), "base64"));
    restoredImages.push(name);
  }

  res.json({ ok: true, restoredFiles, restoredImageCount: restoredImages.length });
});

export function createGrowthBackupRouter() {
  return router;
}
