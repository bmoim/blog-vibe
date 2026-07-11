import express from "express";
import crypto from "node:crypto";
import {
  readGoogleToken,
  saveGoogleToken,
  readGoogleOAuthConfig,
  saveGoogleOAuthConfig
} from "./storage.js";

const router = express.Router();
const FORMAT = "blogger-ai-google-session";
const VERSION = 1;

function persistenceSecret() {
  const value = process.env.TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  if (!value) throw new Error("Google 자동 연결 저장을 위한 서버 보안 키가 설정되지 않았습니다.");
  return crypto.createHash("sha256").update(String(value)).digest();
}

function seal(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", persistenceSecret(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  return Buffer.from(JSON.stringify({
    format: FORMAT,
    version: VERSION,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: encrypted.toString("base64url")
  }), "utf8").toString("base64url");
}

function unseal(blob) {
  let envelope;
  try {
    envelope = JSON.parse(Buffer.from(String(blob || ""), "base64url").toString("utf8"));
  } catch {
    throw Object.assign(new Error("저장된 Google 자동 연결 정보가 올바르지 않습니다."), { status: 400 });
  }
  if (envelope?.format !== FORMAT || Number(envelope.version) !== VERSION) {
    throw Object.assign(new Error("호환되지 않는 Google 자동 연결 정보입니다."), { status: 400 });
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      persistenceSecret(),
      Buffer.from(envelope.iv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64url")),
      decipher.final()
    ]).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Google 자동 연결 정보를 복호화하지 못했습니다. Google을 한 번 다시 연결해 주세요."), { status: 400 });
  }
}

function validatePayload(payload) {
  if (payload?.format !== FORMAT || Number(payload.version) !== VERSION) {
    throw Object.assign(new Error("Google 자동 연결 데이터 형식이 올바르지 않습니다."), { status: 400 });
  }
  if (!payload.token?.refresh_token && !payload.token?.access_token) {
    throw Object.assign(new Error("복원할 Google 토큰이 없습니다."), { status: 400 });
  }
  if (!payload.config?.clientId || !payload.config?.clientSecret) {
    throw Object.assign(new Error("복원할 Google OAuth 설정이 없습니다."), { status: 400 });
  }
  const createdAt = new Date(payload.createdAt || 0).getTime();
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    throw Object.assign(new Error("Google 자동 연결 저장 시점을 확인하지 못했습니다."), { status: 400 });
  }
}

router.get("/google-session/export", async (req, res) => {
  const [token, config] = await Promise.all([
    readGoogleToken(),
    readGoogleOAuthConfig()
  ]);
  if (!token?.refresh_token && !token?.access_token) {
    return res.status(409).json({ error: "Google 계정이 아직 연결되지 않았습니다." });
  }
  if (!config?.clientId || !config?.clientSecret) {
    return res.status(409).json({ error: "업로드한 Google OAuth 설정이 없습니다." });
  }
  const payload = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    token,
    config: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      savedAt: config.savedAt || new Date().toISOString()
    }
  };
  res.set("Cache-Control", "no-store");
  res.json({
    blob: seal(payload),
    hasRefreshToken: Boolean(token.refresh_token),
    createdAt: payload.createdAt
  });
});

router.post("/google-session/restore", async (req, res) => {
  const payload = unseal(req.body?.blob);
  validatePayload(payload);
  await saveGoogleOAuthConfig(payload.config);
  await saveGoogleToken(payload.token);
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    restoredAt: new Date().toISOString(),
    hasRefreshToken: Boolean(payload.token.refresh_token)
  });
});

export function createGooglePersistenceRouter() {
  return router;
}
