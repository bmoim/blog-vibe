import express from "express";
import { google } from "googleapis";
import dns from "node:dns/promises";
import net from "node:net";
import sanitizeHtml from "sanitize-html";
import {
  getDraft,
  readGoogleToken,
  saveGoogleToken,
  readGoogleOAuthConfig
} from "./storage.js";
import { getGoogleRedirectUri } from "./blogger-service.js";
import { getGrowthSettings } from "./growth-storage.js";

const router = express.Router();

async function googleAuthClient() {
  const stored = await readGoogleOAuthConfig();
  const clientId = stored?.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = stored?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const token = await readGoogleToken();
  if (!clientId || !clientSecret) throw new Error("Google OAuth 설정이 필요합니다.");
  if (!token) throw new Error("Google 계정을 다시 연결해 주세요.");
  const client = new google.auth.OAuth2(clientId, clientSecret, getGoogleRedirectUri());
  client.setCredentials(token);
  client.on("tokens", async (tokens) => saveGoogleToken({ ...token, ...tokens }));
  return client;
}

function latestPublishedUrl(draft) {
  const history = Array.isArray(draft?.publishHistory) ? draft.publishHistory : [];
  return [...history].reverse().find((item) => item?.url && item?.status !== "DRAFT")?.url || "";
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || parts[0] === 0;
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
  }
  return true;
}

async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); }
  catch { throw new Error("올바르지 않은 URL"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("HTTP(S) URL만 확인할 수 있습니다.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) throw new Error("로컬 주소는 확인하지 않습니다.");
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) throw new Error("내부 네트워크 주소는 확인하지 않습니다.");
  return url;
}

function extractUrls(article) {
  const urls = new Set();
  for (const source of article?.sources || []) if (source?.url) urls.add(String(source.url));
  const html = String(article?.body_html || "");
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) urls.add(match[1]);
  return [...urls].filter((url) => /^https?:\/\//i.test(url)).slice(0, 30);
}

async function checkUrl(raw) {
  const started = Date.now();
  try {
    const url = await assertPublicUrl(raw);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    let response;
    try {
      response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "Blogger-AI-Publisher-Link-Checker/1.0" }
      });
      if ([403, 405].includes(response.status)) {
        response = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: { "User-Agent": "Blogger-AI-Publisher-Link-Checker/1.0", Range: "bytes=0-1024" }
        });
      }
    } finally {
      clearTimeout(timer);
    }
    return {
      url: raw,
      finalUrl: response.url || raw,
      status: response.status,
      ok: response.ok || (response.status >= 300 && response.status < 400),
      durationMs: Date.now() - started,
      error: null
    };
  } catch (error) {
    return { url: raw, finalUrl: raw, status: 0, ok: false, durationMs: Date.now() - started, error: error.name === "AbortError" ? "시간 초과" : error.message };
  }
}

router.get("/drafts/:id/index-inspection", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const inspectionUrl = latestPublishedUrl(draft);
  if (!inspectionUrl) return res.status(400).json({ error: "이 초안의 공개 발행 URL을 찾지 못했습니다." });
  const settings = await getGrowthSettings();
  if (!settings.searchConsoleSite) return res.status(400).json({ error: "성장 센터에서 Search Console 속성을 먼저 저장해 주세요." });
  const api = google.searchconsole({ version: "v1", auth: await googleAuthClient() });
  const response = await api.urlInspection.index.inspect({
    requestBody: {
      inspectionUrl,
      siteUrl: settings.searchConsoleSite,
      languageCode: "ko-KR"
    }
  });
  const result = response.data.inspectionResult || {};
  res.json({
    url: inspectionUrl,
    indexStatus: result.indexStatusResult || null,
    mobileUsability: result.mobileUsabilityResult || null,
    richResults: result.richResultsResult || null,
    inspectionResultLink: result.inspectionResultLink || null
  });
});

router.get("/drafts/:id/link-health", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const urls = extractUrls(draft.article);
  const results = [];
  for (let index = 0; index < urls.length; index += 5) {
    results.push(...await Promise.all(urls.slice(index, index + 5).map(checkUrl)));
  }
  res.json({
    checkedAt: new Date().toISOString(),
    total: results.length,
    ok: results.filter((item) => item.ok).length,
    broken: results.filter((item) => !item.ok),
    results
  });
});

export function createSiteHealthRouter() {
  return router;
}
