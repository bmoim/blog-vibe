import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { dataDirectory } from "./storage.js";

const SETTINGS_FILE = path.join(dataDirectory, "growth-settings.json");
const SCHEDULES_FILE = path.join(dataDirectory, "growth-schedules.json");
const VERSIONS_FILE = path.join(dataDirectory, "draft-versions.json");
const MONITOR_FILE = path.join(dataDirectory, "growth-monitor.json");

async function ensureDir() {
  await fs.mkdir(dataDirectory, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await ensureDir();
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temp, file);
}

export async function getGrowthSettings() {
  return readJson(SETTINGS_FILE, {
    searchConsoleSite: "",
    ga4PropertyId: "",
    adsenseAccount: "",
    author: {
      name: "",
      role: "",
      bio: "",
      profileUrl: "",
      disclosure: "AI의 도움을 받아 작성하고 사람이 최종 검수했습니다."
    }
  });
}

export async function saveGrowthSettings(input = {}) {
  const current = await getGrowthSettings();
  const clean = {
    ...current,
    searchConsoleSite: String(input.searchConsoleSite ?? current.searchConsoleSite ?? "").trim().slice(0, 500),
    ga4PropertyId: String(input.ga4PropertyId ?? current.ga4PropertyId ?? "").replace(/^properties\//, "").trim().slice(0, 100),
    adsenseAccount: String(input.adsenseAccount ?? current.adsenseAccount ?? "").trim().slice(0, 150),
    author: {
      name: String(input.author?.name ?? current.author?.name ?? "").trim().slice(0, 80),
      role: String(input.author?.role ?? current.author?.role ?? "").trim().slice(0, 120),
      bio: String(input.author?.bio ?? current.author?.bio ?? "").trim().slice(0, 600),
      profileUrl: String(input.author?.profileUrl ?? current.author?.profileUrl ?? "").trim().slice(0, 500),
      disclosure: String(input.author?.disclosure ?? current.author?.disclosure ?? "").trim().slice(0, 300)
    }
  };
  await writeJson(SETTINGS_FILE, clean);
  return clean;
}

export async function listSchedules() {
  return (await readJson(SCHEDULES_FILE, [])).sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt));
}

export async function createSchedule(input) {
  const schedules = await listSchedules();
  const record = {
    id: crypto.randomUUID(),
    draftId: String(input.draftId || ""),
    blogId: String(input.blogId || ""),
    publishAt: new Date(input.publishAt).toISOString(),
    status: "scheduled",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: null,
    error: null
  };
  schedules.push(record);
  await writeJson(SCHEDULES_FILE, schedules);
  return record;
}

export async function updateSchedule(id, patch) {
  const schedules = await listSchedules();
  const index = schedules.findIndex((item) => item.id === id);
  if (index < 0) return null;
  schedules[index] = { ...schedules[index], ...patch, updatedAt: new Date().toISOString() };
  await writeJson(SCHEDULES_FILE, schedules);
  return schedules[index];
}

export async function deleteSchedule(id) {
  const schedules = await listSchedules();
  const found = schedules.some((item) => item.id === id);
  await writeJson(SCHEDULES_FILE, schedules.filter((item) => item.id !== id));
  return found;
}

export async function snapshotDraftVersion(draft, reason = "manual") {
  if (!draft?.id || !draft?.article) return null;
  const versions = await readJson(VERSIONS_FILE, []);
  const record = {
    id: crypto.randomUUID(),
    draftId: draft.id,
    reason,
    createdAt: new Date().toISOString(),
    article: draft.article,
    images: draft.images || [],
    seoScore: draft.seoScore || 0
  };
  versions.push(record);
  const sameDraft = versions.filter((item) => item.draftId === draft.id);
  const keepIds = new Set(sameDraft.slice(-30).map((item) => item.id));
  const trimmed = versions.filter((item) => item.draftId !== draft.id || keepIds.has(item.id));
  await writeJson(VERSIONS_FILE, trimmed);
  return record;
}

export async function listDraftVersions(draftId) {
  return (await readJson(VERSIONS_FILE, []))
    .filter((item) => item.draftId === draftId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getDraftVersion(versionId) {
  return (await readJson(VERSIONS_FILE, [])).find((item) => item.id === versionId) || null;
}

export async function saveMonitorSnapshot(value) {
  const record = { ...value, savedAt: new Date().toISOString() };
  await writeJson(MONITOR_FILE, record);
  return record;
}

export async function getMonitorSnapshot() {
  return readJson(MONITOR_FILE, { candidates: [], savedAt: null });
}
