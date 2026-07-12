import express from "express";
import OpenAI from "openai";
import { google } from "googleapis";
import sanitizeHtml from "sanitize-html";
import {
  getDraft,
  listDrafts,
  saveDraft,
  saveGeneratedImage,
  readGoogleToken,
  saveGoogleToken,
  readGoogleOAuthConfig
} from "./storage.js";
import { getGoogleRedirectUri, publishPost } from "./blogger-service.js";
import { hostImages } from "./image-host.js";
import {
  getGrowthSettings,
  saveGrowthSettings,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  snapshotDraftVersion,
  listDraftVersions,
  getDraftVersion,
  saveMonitorSnapshot,
  getMonitorSnapshot
} from "./growth-storage.js";

const router = express.Router();
let schedulerStarted = false;
let schedulerRunning = false;

function safeText(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function stripHtml(value) {
  return sanitizeHtml(String(value || ""), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim();
}

function dateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return dateOnly(date);
}

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

function openaiClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 540000),
    maxRetries: 2
  });
}

function configuredModel() {
  const model = String(process.env.OPENAI_TEXT_MODEL || "gpt-5.6").trim();
  return model === "gpt-5.6-terra" ? "gpt-5.6" : model;
}

async function fullDrafts() {
  const summaries = await listDrafts();
  const drafts = await Promise.all(summaries.map((item) => getDraft(item.id)));
  return drafts.filter(Boolean);
}

function latestPublishedUrl(draft) {
  const history = Array.isArray(draft?.publishHistory) ? draft.publishHistory : [];
  return [...history].reverse().find((item) => item?.url)?.url || "";
}

function tokenize(value) {
  const stop = new Set(["그리고", "또는", "위한", "대한", "하는", "에서", "으로", "방법", "정리", "가이드", "알아보기", "최신", "기준"]);
  return new Set(
    stripHtml(value)
      .toLowerCase()
      .match(/[가-힣a-z0-9]{2,}/g)?.filter((token) => !stop.has(token)) || []
  );
}

function similarity(left, right) {
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function duplicateSentenceRatio(text) {
  const sentences = stripHtml(text).split(/[.!?。！？]\s*/).map((item) => item.trim()).filter((item) => item.length >= 20);
  if (!sentences.length) return 0;
  const normalized = sentences.map((item) => item.replace(/\s+/g, " ").toLowerCase());
  return 1 - new Set(normalized).size / normalized.length;
}

function qualityGate(draft, settings) {
  const article = draft.article || {};
  const body = stripHtml(article.body_html);
  const currentYear = new Date().getFullYear();
  const oldYearPattern = new RegExp(`\\b(20(?:1[0-9]|2[0-${Math.max(0, currentYear - 2020 - 1)}]))\\b`, "g");
  const checks = [];
  const add = (name, passed, weight, level = "warning", detail = "") => checks.push({ name, passed, weight, level, detail });
  add("제목 길이", article.title?.length >= 20 && article.title?.length <= 65, 10, "warning", "20~65자를 권장합니다.");
  add("메타 설명", article.meta_description?.length >= 70 && article.meta_description?.length <= 165, 10, "warning", "70~165자를 권장합니다.");
  add("충분한 본문", body.length >= 1200, 15, "blocker", "본문이 너무 짧으면 공개 발행을 권장하지 않습니다.");
  add("소제목 구조", /<h2[\s>]/i.test(article.body_html || ""), 8, "warning", "H2 소제목이 필요합니다.");
  add("목록 또는 표", /<(ul|ol|table)[\s>]/i.test(article.body_html || ""), 7, "warning", "비교표나 체크리스트를 추가하세요.");
  add("공식 출처", Array.isArray(article.sources) && article.sources.length > 0, 15, "blocker", "최신 글은 확인 가능한 출처가 필요합니다.");
  add("대표 썸네일", Array.isArray(draft.images) && draft.images.some((image) => image.kind === "main-thumbnail" || /대표 썸네일/.test(image.alt || "")), 8, "warning", "1:1 대표 썸네일을 생성하세요.");
  add("깨진 이미지 마커 없음", !/\{\{IMAGE_\d+\}\}/.test((article.body_html || "").replace(/\{\{IMAGE_\d+\}\}/g, "")), 5, "warning", "이미지 마커를 확인하세요.");
  add("중복 문장 비율", duplicateSentenceRatio(article.body_html) < 0.12, 8, "warning", "반복 문장을 줄이세요.");
  add("작성자 정보", Boolean(settings.author?.name && settings.author?.bio), 7, "warning", "작성자 프로필을 설정하세요.");
  add("오래된 연도 오표기 점검", !(oldYearPattern.test(`${article.title || ""} ${body.slice(0, 3000)}`)), 7, "warning", "과거 연도가 현재 기준처럼 쓰였는지 확인하세요.");
  const score = Math.round(checks.reduce((sum, check) => sum + (check.passed ? check.weight : 0), 0) / checks.reduce((sum, check) => sum + check.weight, 0) * 100);
  return {
    score,
    pass: !checks.some((check) => !check.passed && check.level === "blocker") && score >= 75,
    blockers: checks.filter((check) => !check.passed && check.level === "blocker"),
    checks
  };
}

async function searchConsoleSites() {
  const api = google.searchconsole({ version: "v1", auth: await googleAuthClient() });
  const response = await api.sites.list();
  return (response.data.siteEntry || []).map((site) => ({ siteUrl: site.siteUrl, permissionLevel: site.permissionLevel }));
}

async function searchRows(siteUrl, startDate, endDate) {
  const api = google.searchconsole({ version: "v1", auth: await googleAuthClient() });
  const response = await api.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions: ["page", "query"],
      rowLimit: 5000,
      dataState: "final"
    }
  });
  return response.data.rows || [];
}

function aggregatePerformance(rows) {
  const pageMap = new Map();
  const queryMap = new Map();
  for (const row of rows) {
    const [page = "", query = ""] = row.keys || [];
    const clicks = Number(row.clicks || 0);
    const impressions = Number(row.impressions || 0);
    const position = Number(row.position || 0);
    const pageRecord = pageMap.get(page) || { page, clicks: 0, impressions: 0, weightedPosition: 0, queries: [] };
    pageRecord.clicks += clicks;
    pageRecord.impressions += impressions;
    pageRecord.weightedPosition += position * Math.max(1, impressions);
    pageRecord.queries.push({ query, clicks, impressions, ctr: Number(row.ctr || 0), position });
    pageMap.set(page, pageRecord);

    const queryRecord = queryMap.get(query) || { query, clicks: 0, impressions: 0, weightedPosition: 0 };
    queryRecord.clicks += clicks;
    queryRecord.impressions += impressions;
    queryRecord.weightedPosition += position * Math.max(1, impressions);
    queryMap.set(query, queryRecord);
  }
  const normalize = (record) => ({
    ...record,
    ctr: record.impressions ? record.clicks / record.impressions : 0,
    position: record.impressions ? record.weightedPosition / record.impressions : 0
  });
  return {
    pages: [...pageMap.values()].map(normalize),
    queries: [...queryMap.values()].map(normalize)
  };
}

async function searchPerformance(siteUrl, days = 28) {
  if (!siteUrl) return { configured: false, totals: {}, lowCtr: [], nearWins: [], declines: [], topQueries: [] };
  const currentEnd = daysAgo(2);
  const currentStart = daysAgo(days + 1);
  const previousEnd = daysAgo(days + 2);
  const previousStart = daysAgo(days * 2 + 1);
  const [currentRows, previousRows] = await Promise.all([
    searchRows(siteUrl, currentStart, currentEnd),
    searchRows(siteUrl, previousStart, previousEnd)
  ]);
  const current = aggregatePerformance(currentRows);
  const previous = aggregatePerformance(previousRows);
  const previousPages = new Map(previous.pages.map((item) => [item.page, item]));
  const totals = current.pages.reduce((total, page) => ({
    clicks: total.clicks + page.clicks,
    impressions: total.impressions + page.impressions
  }), { clicks: 0, impressions: 0 });
  totals.ctr = totals.impressions ? totals.clicks / totals.impressions : 0;
  const weighted = current.pages.reduce((sum, page) => sum + page.position * page.impressions, 0);
  totals.position = totals.impressions ? weighted / totals.impressions : 0;

  const lowCtr = current.pages.filter((page) => page.impressions >= 50 && page.ctr < 0.025).sort((a, b) => b.impressions - a.impressions).slice(0, 20);
  const nearWins = current.pages.filter((page) => page.impressions >= 20 && page.position >= 4 && page.position <= 20).sort((a, b) => a.position - b.position || b.impressions - a.impressions).slice(0, 20);
  const declines = current.pages.map((page) => {
    const before = previousPages.get(page.page);
    if (!before) return null;
    return {
      ...page,
      previousClicks: before.clicks,
      clickChange: page.clicks - before.clicks,
      previousPosition: before.position,
      positionChange: page.position - before.position
    };
  }).filter((item) => item && (item.clickChange < -2 || item.positionChange > 2)).sort((a, b) => a.clickChange - b.clickChange).slice(0, 20);
  const topQueries = current.queries.sort((a, b) => b.impressions - a.impressions).slice(0, 30);
  return { configured: true, period: { currentStart, currentEnd, previousStart, previousEnd }, totals, lowCtr, nearWins, declines, topQueries };
}

async function ga4Overview(propertyId) {
  if (!propertyId) return { configured: false };
  const api = google.analyticsdata({ version: "v1beta", auth: await googleAuthClient() });
  const response = await api.properties.runReport({
    property: `properties/${String(propertyId).replace(/^properties\//, "")}`,
    requestBody: {
      dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "sessions" }, { name: "averageSessionDuration" }]
    }
  });
  const values = response.data.rows?.[0]?.metricValues || [];
  return {
    configured: true,
    pageViews: Number(values[0]?.value || 0),
    activeUsers: Number(values[1]?.value || 0),
    sessions: Number(values[2]?.value || 0),
    averageSessionDuration: Number(values[3]?.value || 0)
  };
}

async function adsenseOverview(accountInput) {
  const api = google.adsense({ version: "v2", auth: await googleAuthClient() });
  let account = accountInput;
  if (!account) {
    const accounts = await api.accounts.list({ pageSize: 20 });
    account = accounts.data.accounts?.[0]?.name || "";
  }
  if (!account) return { configured: false };
  const report = await api.accounts.reports.generate({
    account,
    dateRange: "LAST_30_DAYS",
    metrics: ["ESTIMATED_EARNINGS", "PAGE_VIEWS", "IMPRESSIONS", "CLICKS", "PAGE_VIEWS_RPM"]
  });
  const row = report.data.rows?.[0]?.cells || [];
  return {
    configured: true,
    account,
    currencyCode: report.data.header?.currencyCode || "",
    estimatedEarnings: Number(row[0]?.value || 0),
    pageViews: Number(row[1]?.value || 0),
    impressions: Number(row[2]?.value || 0),
    clicks: Number(row[3]?.value || 0),
    pageViewsRpm: Number(row[4]?.value || 0)
  };
}

function freshnessCandidates(drafts) {
  const now = Date.now();
  const currentYear = new Date().getFullYear();
  const sensitive = /(가격|비용|지원금|신청|기간|법령|세금|보험|금리|대출|부작용|약|제품|사양|요금|정책|혜택)/;
  return drafts.map((draft) => {
    const text = `${draft.article?.title || ""} ${stripHtml(draft.article?.body_html).slice(0, 5000)}`;
    const ageDays = Math.floor((now - new Date(draft.updatedAt || draft.createdAt || now).getTime()) / 86400000);
    const oldYears = [...new Set((text.match(/20\d{2}/g) || []).map(Number).filter((year) => year < currentYear))];
    let score = Math.min(40, Math.floor(ageDays / 30) * 6);
    if (sensitive.test(text)) score += 30;
    if (oldYears.length) score += 20;
    if (!draft.article?.sources?.length) score += 10;
    return {
      draftId: draft.id,
      title: draft.article?.title || "제목 없음",
      ageDays,
      oldYears,
      sensitive: sensitive.test(text),
      score: Math.min(100, score),
      publishedUrl: latestPublishedUrl(draft)
    };
  }).filter((item) => item.score >= 25).sort((a, b) => b.score - a.score);
}

async function deepFreshnessAudit(draft) {
  const schema = {
    type: "object", additionalProperties: false,
    required: ["summary", "checked_date", "issues"],
    properties: {
      summary: { type: "string" },
      checked_date: { type: "string" },
      issues: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["severity", "type", "current_text", "recommended_update", "source_url"], properties: {
        severity: { type: "string", enum: ["high", "medium", "low"] },
        type: { type: "string" },
        current_text: { type: "string" },
        recommended_update: { type: "string" },
        source_url: { type: "string" }
      } } }
    }
  };
  const response = await openaiClient().responses.create({
    model: configuredModel(),
    reasoning: { effort: "low" },
    instructions: "현재 웹 정보를 확인해 오래된 블로그 글의 사실, 날짜, 가격, 제도, 링크를 검수하는 편집자다. 확인되지 않은 내용을 만들지 않는다.",
    input: `오늘 날짜는 ${dateOnly(new Date())}이다. 다음 글에서 현재와 달라졌거나 확인이 필요한 부분만 찾아라. 공식 출처를 우선하며 source_url에는 실제 확인한 URL을 넣어라.\n\n제목: ${draft.article.title}\n메타: ${draft.article.meta_description}\n본문: ${stripHtml(draft.article.body_html).slice(0, 12000)}\n기존 출처: ${JSON.stringify(draft.article.sources || [])}`,
    max_output_tokens: 5000,
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required",
    text: { format: { type: "json_schema", name: "freshness_audit", strict: true, schema } }
  });
  return JSON.parse(response.output_text);
}

async function generateVariants(draft) {
  const schema = {
    type: "object", additionalProperties: false,
    required: ["title_options", "thumbnail_options"],
    properties: {
      title_options: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["type", "title", "reason"], properties: { type: { type: "string" }, title: { type: "string" }, reason: { type: "string" } } } },
      thumbnail_options: { type: "array", minItems: 3, maxItems: 3, items: { type: "object", additionalProperties: false, required: ["style", "headline", "prompt"], properties: { style: { type: "string" }, headline: { type: "string" }, prompt: { type: "string" } } } }
    }
  };
  const response = await openaiClient().responses.create({
    model: configuredModel(),
    reasoning: { effort: "low" },
    instructions: "검색 클릭률을 높이되 과장하지 않는 한국어 콘텐츠 편집자이자 썸네일 아트디렉터다.",
    input: `다음 글에 대해 서로 다른 제목 3개와 1:1 블로그 썸네일 디자인 프롬프트 3개를 제안하라. 제목 유형은 즉답형, 숫자·비교형, 문제해결형으로 구분한다. 썸네일은 비교 카드형, 숫자 강조형, 체크리스트형으로 구분하고 흰 배경과 블루·보라 포인트를 유지한다. 확인되지 않은 숫자는 넣지 않는다.\n제목: ${draft.article.title}\n메타: ${draft.article.meta_description}\n본문 요약: ${stripHtml(draft.article.body_html).slice(0, 5000)}`,
    max_output_tokens: 4000,
    text: { format: { type: "json_schema", name: "content_variants", strict: true, schema } }
  });
  return JSON.parse(response.output_text);
}

function authorBox(settings) {
  const author = settings.author || {};
  if (!author.name) throw new Error("먼저 성장 센터에서 작성자 이름을 저장해 주세요.");
  const profile = author.profileUrl ? `<a href="${sanitizeHtml(author.profileUrl, { allowedTags: [] })}" target="_blank" rel="noopener noreferrer">작성자 프로필</a>` : "";
  return `<section class="author-trust-box" style="margin:36px 0 12px;padding:20px;border:1px solid #e5e7eb;border-radius:14px;background:#fafafa"><h2 style="margin-top:0">작성자 및 검수 정보</h2><p><strong>${sanitizeHtml(author.name, { allowedTags: [] })}</strong>${author.role ? ` · ${sanitizeHtml(author.role, { allowedTags: [] })}` : ""}</p><p>${sanitizeHtml(author.bio || "", { allowedTags: [] })}</p>${profile ? `<p>${profile}</p>` : ""}<p style="font-size:.92em;color:#666">최종 검수일: ${dateOnly(new Date())}${author.disclosure ? ` · ${sanitizeHtml(author.disclosure, { allowedTags: [] })}` : ""}</p></section>`;
}

function figureHtml(image, src) {
  const alt = sanitizeHtml(image.alt || "", { allowedTags: [], allowedAttributes: {} });
  const caption = sanitizeHtml(image.caption || "", { allowedTags: [], allowedAttributes: {} });
  return `<figure style="margin:28px 0;text-align:center"><img src="${src}" alt="${alt}" loading="lazy" style="max-width:100%;height:auto;border-radius:12px"><figcaption style="margin-top:8px;color:#666;font-size:.92em">${caption}</figcaption></figure>`;
}

function replaceImageMarkers(html, images, key) {
  let content = html;
  for (const image of images) {
    const marker = `{{IMAGE_${image.index}}}`;
    if (!image[key]) continue;
    content = content.replaceAll(`<p>${marker}</p>`, figureHtml(image, image[key])).replaceAll(marker, figureHtml(image, image[key]));
  }
  return content;
}

function appendExtras(article, html) {
  let result = html;
  if (article.faq?.length) result += `<section><h2>자주 묻는 질문</h2>${article.faq.map((item) => `<h3>${sanitizeHtml(item.question, { allowedTags: [] })}</h3><p>${sanitizeHtml(item.answer, { allowedTags: ["strong", "em", "br"] })}</p>`).join("")}</section>`;
  if (article.sources?.length) result += `<section><h2>참고 자료</h2><ul>${article.sources.map((source) => `<li><a href="${source.url}" target="_blank" rel="nofollow noopener noreferrer">${sanitizeHtml(source.title, { allowedTags: [] })}</a></li>`).join("")}</ul></section>`;
  if (article.risk_notice) result += `<p style="padding:14px;background:#f5f5f5;border-radius:8px;color:#555"><strong>안내:</strong> ${sanitizeHtml(article.risk_notice, { allowedTags: [] })}</p>`;
  return result;
}

async function publishScheduledDraft(schedule) {
  const draft = await getDraft(schedule.draftId);
  if (!draft) throw new Error("예약한 초안을 찾을 수 없습니다.");
  let images = draft.images || [];
  if (images.length) images = await hostImages(images, draft.id);
  let content = replaceImageMarkers(draft.article.body_html, images, "hostedUrl");
  content = appendExtras(draft.article, content);
  const result = await publishPost({
    blogId: schedule.blogId,
    title: draft.article.title,
    content,
    labels: draft.article.labels,
    isDraft: false
  });
  await saveDraft({
    ...draft,
    images,
    publishHistory: [...(draft.publishHistory || []), { ...result, blogId: schedule.blogId, publishedAt: new Date().toISOString(), scheduled: true }]
  });
  return result;
}

async function runDueSchedules() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const due = (await listSchedules()).filter((item) => item.status === "scheduled" && new Date(item.publishAt).getTime() <= Date.now());
    for (const schedule of due) {
      await updateSchedule(schedule.id, { status: "processing", error: null });
      try {
        const result = await publishScheduledDraft(schedule);
        await updateSchedule(schedule.id, { status: "published", result });
      } catch (error) {
        await updateSchedule(schedule.id, { status: "failed", error: error.message || "예약 발행 실패" });
      }
    }
  } finally {
    schedulerRunning = false;
  }
}

export function startGrowthScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setTimeout(runDueSchedules, 5000);
  setInterval(runDueSchedules, 60000).unref();
}

router.get("/settings", async (req, res) => res.json({ settings: await getGrowthSettings() }));
router.put("/settings", async (req, res) => res.json({ settings: await saveGrowthSettings(req.body || {}) }));
router.get("/sites", async (req, res) => res.json({ sites: await searchConsoleSites() }));
router.get("/drafts", async (req, res) => res.json({ drafts: await listDrafts() }));

router.get("/dashboard", async (req, res) => {
  const settings = await getGrowthSettings();
  const results = await Promise.allSettled([
    searchPerformance(settings.searchConsoleSite, Number(req.query.days || 28)),
    ga4Overview(settings.ga4PropertyId),
    adsenseOverview(settings.adsenseAccount)
  ]);
  const normalize = (result) => result.status === "fulfilled" ? result.value : { configured: false, error: result.reason?.message || "데이터 조회 실패" };
  res.json({ searchConsole: normalize(results[0]), ga4: normalize(results[1]), adsense: normalize(results[2]) });
});

router.get("/monitor", async (req, res) => {
  const candidates = freshnessCandidates(await fullDrafts());
  const snapshot = await saveMonitorSnapshot({ candidates });
  res.json(snapshot);
});
router.get("/monitor/last", async (req, res) => res.json(await getMonitorSnapshot()));
router.post("/drafts/:id/freshness-audit", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  res.json({ audit: await deepFreshnessAudit(draft) });
});

router.get("/drafts/:id/quality", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  res.json({ quality: qualityGate(draft, await getGrowthSettings()) });
});

router.get("/drafts/:id/cannibalization", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const source = `${draft.article.title} ${draft.article.meta_description} ${stripHtml(draft.article.body_html).slice(0, 3000)}`;
  const matches = (await fullDrafts()).filter((item) => item.id !== draft.id).map((item) => ({
    draftId: item.id,
    title: item.article.title,
    url: latestPublishedUrl(item),
    similarity: similarity(source, `${item.article.title} ${item.article.meta_description} ${stripHtml(item.article.body_html).slice(0, 3000)}`)
  })).filter((item) => item.similarity >= 0.12).sort((a, b) => b.similarity - a.similarity).slice(0, 10);
  res.json({ matches, risk: matches[0]?.similarity >= 0.45 ? "high" : matches[0]?.similarity >= 0.25 ? "medium" : "low" });
});

router.get("/drafts/:id/internal-links", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const source = `${draft.article.title} ${draft.article.meta_description} ${stripHtml(draft.article.body_html).slice(0, 4000)}`;
  const suggestions = (await fullDrafts()).filter((item) => item.id !== draft.id && latestPublishedUrl(item)).map((item) => ({
    draftId: item.id,
    title: item.article.title,
    url: latestPublishedUrl(item),
    score: similarity(source, `${item.article.title} ${item.article.meta_description} ${stripHtml(item.article.body_html).slice(0, 2500)}`)
  })).filter((item) => item.score >= 0.08).sort((a, b) => b.score - a.score).slice(0, 5);
  res.json({ suggestions });
});

router.post("/drafts/:id/internal-links/apply", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const links = Array.isArray(req.body.links) ? req.body.links.slice(0, 5) : [];
  if (!links.length) return res.status(400).json({ error: "적용할 관련 글을 선택해 주세요." });
  await snapshotDraftVersion(draft, "internal-links");
  const section = `<section class="related-posts"><h2>함께 읽으면 좋은 글</h2><ul>${links.map((link) => `<li><a href="${sanitizeHtml(link.url, { allowedTags: [] })}">${sanitizeHtml(link.title, { allowedTags: [] })}</a></li>`).join("")}</ul></section>`;
  const body = String(draft.article.body_html || "").replace(/<section class="related-posts">[\s\S]*?<\/section>/i, "");
  const saved = await saveDraft({ ...draft, article: { ...draft.article, body_html: `${body}\n${section}` } });
  res.json({ draft: saved });
});

router.post("/drafts/:id/author/apply", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  await snapshotDraftVersion(draft, "author-box");
  const box = authorBox(await getGrowthSettings());
  const body = String(draft.article.body_html || "").replace(/<section class="author-trust-box"[\s\S]*?<\/section>/i, "");
  const saved = await saveDraft({ ...draft, article: { ...draft.article, body_html: `${body}\n${box}` } });
  res.json({ draft: saved });
});

router.post("/drafts/:id/variants", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  res.json({ variants: await generateVariants(draft) });
});
router.post("/drafts/:id/title", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const title = safeText(req.body.title, 120);
  if (!title) return res.status(400).json({ error: "적용할 제목이 없습니다." });
  await snapshotDraftVersion(draft, "title-change");
  const saved = await saveDraft({ ...draft, article: { ...draft.article, title } });
  res.json({ draft: saved });
});
router.post("/drafts/:id/thumbnail", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const prompt = safeText(req.body.prompt, 5000);
  if (!prompt) return res.status(400).json({ error: "썸네일 프롬프트가 없습니다." });
  const result = await openaiClient().images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    prompt: `${prompt}\nSquare 1:1 premium Korean blog main thumbnail, white and blue-violet palette, readable Korean headline, no logo, no watermark.`,
    size: "1024x1024",
    quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
    output_format: "webp",
    output_compression: 82,
    n: 1
  });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("썸네일 이미지 생성 결과가 비어 있습니다.");
  await snapshotDraftVersion(draft, "thumbnail-change");
  const filename = await saveGeneratedImage(Buffer.from(b64, "base64"), "webp");
  const images = [...(draft.images || [])];
  const thumbnail = { index: 1, kind: "main-thumbnail", filename, localUrl: `/generated/${filename}`, alt: `${draft.article.title} 대표 썸네일`, caption: draft.article.meta_description, prompt };
  const existingIndex = images.findIndex((image) => image.kind === "main-thumbnail" || image.index === 1 || /대표 썸네일/.test(image.alt || ""));
  if (existingIndex >= 0) images[existingIndex] = thumbnail;
  else images.unshift(thumbnail);
  images.forEach((image, index) => { image.index = index + 1; });
  let body = String(draft.article.body_html || "");
  if (!body.includes("{{IMAGE_1}}")) body = `<p>{{IMAGE_1}}</p>\n${body}`;
  const saved = await saveDraft({ ...draft, images, article: { ...draft.article, body_html: body } });
  res.json({ draft: saved, thumbnail });
});

router.get("/drafts/:id/versions", async (req, res) => res.json({ versions: await listDraftVersions(req.params.id) }));
router.post("/drafts/:id/versions/snapshot", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  res.json({ version: await snapshotDraftVersion(draft, safeText(req.body.reason, 100) || "manual") });
});
router.post("/drafts/:id/versions/:versionId/restore", async (req, res) => {
  const [draft, version] = await Promise.all([getDraft(req.params.id), getDraftVersion(req.params.versionId)]);
  if (!draft || !version || version.draftId !== draft.id) return res.status(404).json({ error: "복원할 버전을 찾을 수 없습니다." });
  await snapshotDraftVersion(draft, "before-restore");
  const saved = await saveDraft({ ...draft, article: version.article, images: version.images || draft.images, seoScore: version.seoScore || draft.seoScore });
  res.json({ draft: saved });
});

router.get("/schedules", async (req, res) => res.json({ schedules: await listSchedules() }));
router.post("/schedules", async (req, res) => {
  const draftId = safeText(req.body.draftId, 100);
  const blogId = safeText(req.body.blogId, 100);
  const publishAt = new Date(req.body.publishAt);
  if (!draftId || !blogId || Number.isNaN(publishAt.getTime())) return res.status(400).json({ error: "초안, 블로그, 예약 시간을 모두 입력해 주세요." });
  if (publishAt.getTime() <= Date.now() + 60000) return res.status(400).json({ error: "예약 시간은 현재보다 최소 1분 이후여야 합니다." });
  res.json({ schedule: await createSchedule({ draftId, blogId, publishAt }) });
});
router.delete("/schedules/:id", async (req, res) => res.status(await deleteSchedule(req.params.id) ? 200 : 404).json({ ok: true }));
router.post("/schedules/run", async (req, res) => { await runDueSchedules(); res.json({ schedules: await listSchedules() }); });

export function createGrowthRouter() {
  return router;
}
