import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
export const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
export const generatedDirectory = path.resolve(process.env.GENERATED_DIR || path.join(ROOT, "public", "generated"));
const DRAFTS_FILE = path.join(dataDirectory, "drafts.json");
const TOKEN_FILE = path.join(dataDirectory, "google-token.json");
const USAGE_FILE = path.join(dataDirectory, "usage.json");

async function ensureDirs() { await fs.mkdir(dataDirectory, { recursive: true }); await fs.mkdir(generatedDirectory, { recursive: true }); }
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; } }
async function writeJsonAtomic(file, value) { await ensureDirs(); const temp = `${file}.${crypto.randomUUID()}.tmp`; await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8"); await fs.rename(temp, file); }
function tokenKey() { const secret = process.env.TOKEN_ENCRYPTION_KEY; return secret ? crypto.createHash("sha256").update(secret).digest() : null; }
function encryptToken(token) {
  const key = tokenKey(); if (!key) return token;
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(token), "utf8"), cipher.final()]);
  return { version: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") };
}
function decryptToken(record) {
  if (!record || record.version !== 1 || record.algorithm !== "aes-256-gcm") return record;
  const key = tokenKey(); if (!key) throw new Error("TOKEN_ENCRYPTION_KEY가 없어 저장된 Google 토큰을 복호화할 수 없습니다.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, "base64")), decipher.final()]).toString("utf8"));
}
export async function listDrafts() { const drafts = await readJson(DRAFTS_FILE, []); return drafts.map(({ article, images, ...draft }) => ({ ...draft, title: article?.title || "제목 없음", imageCount: images?.length || 0, seoScore: draft.seoScore || 0 })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)); }
export async function getDraft(id) { return (await readJson(DRAFTS_FILE, [])).find((draft) => draft.id === id) || null; }
export async function saveDraft(draft) {
  const drafts = await readJson(DRAFTS_FILE, []); const now = new Date().toISOString();
  const record = { ...draft, id: draft.id || crypto.randomUUID(), createdAt: draft.createdAt || now, updatedAt: now };
  const index = drafts.findIndex((item) => item.id === record.id); if (index >= 0) drafts[index] = record; else drafts.push(record);
  await writeJsonAtomic(DRAFTS_FILE, drafts); return record;
}
export async function deleteDraft(id) {
  const drafts = await readJson(DRAFTS_FILE, []); const target = drafts.find((draft) => draft.id === id);
  await writeJsonAtomic(DRAFTS_FILE, drafts.filter((draft) => draft.id !== id));
  if (target?.images?.length) await Promise.all(target.images.map(async (image) => { if (!image.filename) return; try { await fs.unlink(path.join(generatedDirectory, path.basename(image.filename))); } catch (error) { if (error.code !== "ENOENT") throw error; } }));
  return Boolean(target);
}
export async function saveGeneratedImage(buffer, extension = "webp") { await ensureDirs(); const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`; await fs.writeFile(path.join(generatedDirectory, filename), buffer); return filename; }
export function generatedImagePath(filename) { return path.join(generatedDirectory, path.basename(filename)); }
export async function readGoogleToken() { return decryptToken(await readJson(TOKEN_FILE, null)); }
export async function saveGoogleToken(token) { await writeJsonAtomic(TOKEN_FILE, encryptToken(token)); }
export async function removeGoogleToken() { try { await fs.unlink(TOKEN_FILE); } catch (error) { if (error.code !== "ENOENT") throw error; } }
export async function getDailyUsage() { const today = new Date().toISOString().slice(0, 10); const usage = await readJson(USAGE_FILE, { date: today, count: 0 }); return usage.date === today ? usage : { date: today, count: 0 }; }
export async function incrementDailyUsage() { const usage = await getDailyUsage(); const next = { ...usage, count: usage.count + 1 }; await writeJsonAtomic(USAGE_FILE, next); return next; }
