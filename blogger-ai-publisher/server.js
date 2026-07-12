import "dotenv/config";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import session from "express-session";
import sessionFileStore from "session-file-store";
import sanitizeHtml from "sanitize-html";
import { generateArticle, generateImages, polishArticle, listAvailableTextModels } from "./lib/openai-service.js";
import { createGoogleAuthUrl, disconnectGoogle, handleGoogleCallback, isGoogleConnected, getGoogleConfigStatus, saveGoogleConfigFromJson, clearGoogleConfig, listBlogs, lookupBlogByUrl, publishPost, getGoogleRedirectUri } from "./lib/blogger-service.js";
import { deleteDraft, getDailyUsage, getDraft, incrementDailyUsage, listDrafts, saveDraft, generatedDirectory, dataDirectory } from "./lib/storage.js";
import { hostImages, imageHostConfigured } from "./lib/image-host.js";
import { loadGenerationJobs, persistGenerationJobs } from "./lib/generation-job-store.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const FileStore = sessionFileStore(session);
const generationJobs = await loadGenerationJobs();

app.set("trust proxy", 1);
app.get("/health", (req, res) => res.json({
  ok: true,
  timestamp: new Date().toISOString(),
  uptimeSeconds: Math.floor(process.uptime()),
  activeGenerationJobs: [...generationJobs.values()].filter((job) => ["queued", "running"].includes(job.status)).length
}));

// Blogger, 검색엔진, 썸네일 수집기가 생성 이미지를 로그인 없이 읽을 수 있어야 한다.
// 앱 화면과 API는 계속 Basic Auth로 보호하고 /generated 경로만 공개한다.
app.use(
  "/generated",
  (req, res, next) => {
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.set("Access-Control-Allow-Origin", "*");
    next();
  },
  express.static(generatedDirectory, { maxAge: "1y", immutable: true, fallthrough: true })
);

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAppAuth(req, res, next) {
  const expectedUser = process.env.APP_USERNAME || "admin";
  const expectedPassword = process.env.APP_PASSWORD;
  if (!expectedPassword) {
    if (process.env.NODE_ENV === "production") return res.status(503).send("APP_PASSWORD가 설정되지 않았습니다.");
    return next();
  }
  const authorization = req.headers.authorization || "";
  const [scheme, encoded] = authorization.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const username = separator >= 0 ? decoded.slice(0, separator) : "";
    const password = separator >= 0 ? decoded.slice(separator + 1) : "";
    if (safeEqual(username, expectedUser) && safeEqual(password, expectedPassword)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Blogger AI Publisher", charset="UTF-8"');
  return res.status(401).send("로그인이 필요합니다.");
}

app.use(requireAppAuth);
app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new FileStore({ path: path.join(dataDirectory, "sessions"), retries: 1, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || "local-dev-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 }
}));
app.use((req, res, next) => {
  if (req.path === "/" || /\.(?:html|js|css)$/i.test(req.path)) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Surrogate-Control", "no-store");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});
app.use(express.static(path.join(ROOT, "public"), { maxAge: 0, etag: true }));

function safeText(value, max = 500) { return String(value || "").trim().slice(0, max); }
function koreaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function seoScore(article, keyword, imageCount) {
  const text = sanitizeHtml(article.body_html || "", { allowedTags: [], allowedAttributes: {} });
  const title = article.title || "";
  const meta = article.meta_description || "";
  const target = (keyword || "").trim().toLowerCase();
  let score = 0;
  const checks = [];
  const add = (name, passed, points) => { if (passed) score += points; checks.push({ name, passed, points }); };
  add("제목 길이", title.length >= 20 && title.length <= 65, 15);
  add("메타 설명 길이", meta.length >= 70 && meta.length <= 165, 15);
  add("본문 분량", text.length >= 1200, 15);
  add("소제목 구조", /<h2[\s>]/i.test(article.body_html || ""), 10);
  add("목록 또는 표", /<(ul|ol|table)[\s>]/i.test(article.body_html || ""), 10);
  add("FAQ", (article.faq || []).length >= 2, 10);
  add("이미지", imageCount >= 1, 10);
  add("출처", (article.sources || []).length >= 1, 5);
  add("키워드 제목 포함", !target || title.toLowerCase().includes(target), 5);
  add("키워드 본문 포함", !target || text.toLowerCase().includes(target), 5);
  return { score: Math.min(100, score), checks, characterCount: text.length };
}

function figureHtml(image, src) {
  const alt = sanitizeHtml(image.alt || "", { allowedTags: [], allowedAttributes: {} });
  const caption = sanitizeHtml(image.caption || "", { allowedTags: [], allowedAttributes: {} });
  return `<figure style="margin:28px 0;text-align:center"><img src="${src}" alt="${alt}" loading="lazy" style="max-width:100%;height:auto;border-radius:12px"><figcaption style="margin-top:8px;color:#666;font-size:0.92em">${caption}</figcaption></figure>`;
}

function replaceImageMarkers(html, images, sourceKey) {
  let result = html;
  for (const image of images) {
    const marker = `{{IMAGE_${image.index}}}`;
    const src = image[sourceKey];
    if (!src) continue;
    result = result.replaceAll(`<p>${marker}</p>`, figureHtml(image, src));
    result = result.replaceAll(marker, figureHtml(image, src));
  }
  return result;
}

function appendExtras(article, html) {
  let result = html;
  if (article.faq?.length) result += `<section><h2>자주 묻는 질문</h2>${article.faq.map((item) => `<h3>${sanitizeHtml(item.question, { allowedTags: [] })}</h3><p>${sanitizeHtml(item.answer, { allowedTags: ["strong", "em", "br"] })}</p>`).join("")}</section>`;
  if (article.sources?.length) result += `<section><h2>참고 자료</h2><ul>${article.sources.map((source) => `<li><a href="${source.url}" target="_blank" rel="nofollow noopener noreferrer">${sanitizeHtml(source.title, { allowedTags: [] })}</a></li>`).join("")}</ul></section>`;
  if (article.risk_notice) result += `<p style="padding:14px;background:#f5f5f5;border-radius:8px;color:#555"><strong>안내:</strong> ${sanitizeHtml(article.risk_notice, { allowedTags: [] })}</p>`;
  return result;
}

function sanitizeArticleHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: ["h2", "h3", "h4", "p", "br", "strong", "em", "u", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "blockquote", "a", "figure", "figcaption", "img", "section", "div", "span", "code", "pre", "hr"],
    allowedAttributes: { a: ["href", "target", "rel", "title"], img: ["src", "alt", "loading", "width", "height", "style"], "*": ["style", "class"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false
  });
}

function withPreview(draft) {
  const previewBody = replaceImageMarkers(draft.article.body_html, draft.images || [], "localUrl");
  return { ...draft, previewHtml: sanitizeArticleHtml(appendExtras(draft.article, previewBody)) };
}

function buildGenerationInput(body = {}) {
  return {
    topic: safeText(body.topic, 300),
    targetKeyword: safeText(body.targetKeyword, 150),
    audience: safeText(body.audience, 200),
    tone: safeText(body.tone, 200),
    language: safeText(body.language, 50) || "한국어",
    articleLength: Number(body.articleLength || 2500),
    imageCount: Number(body.imageCount ?? 2),
    customInstructions: safeText(body.customInstructions, 1500),
    useWebResearch: true,
    premiumReview: Boolean(body.premiumReview),
    textModel: safeText(body.textModel, 100) || process.env.OPENAI_TEXT_MODEL || "gpt-5.6",
    currentDate: koreaDate()
  };
}

async function generateDraft(input, onProgress = () => {}) {
  onProgress(12, "최신 자료를 검색하고 글 구조를 설계하고 있습니다.", "article");
  let article = await generateArticle(input);

  if (input.premiumReview) {
    onProgress(56, `오늘(${input.currentDate}) 기준으로 2차 편집장 검수를 진행하고 있습니다.`, "review");
    article = await polishArticle(article, input);
    onProgress(72, "글 작성과 정밀 검수가 완료되었습니다.", "review-completed");
  } else {
    onProgress(66, "글 작성과 최신 자료 확인이 완료되었습니다.", "article-completed");
  }

  onProgress(76, "1:1 대표 썸네일과 본문 이미지를 생성하고 있습니다.", "images");
  let images = [];
  let imageWarning = "";
  try {
    images = await generateImages(article.image_prompts);
  } catch (error) {
    console.error("Image generation failed; saving text draft:", error);
    imageWarning = `이미지는 생성하지 못했지만 글 초안은 저장했습니다. ${error.message || "이미지 생성 오류"}`;
    onProgress(90, "이미지 생성에 실패해 글 초안을 먼저 저장하고 있습니다.", "saving-without-images");
  }

  onProgress(94, "초안과 SEO 점수를 저장하고 있습니다.", "saving");
  const seo = seoScore(article, input.targetKeyword || input.topic, images.length);
  const draft = await saveDraft({
    input,
    article,
    images,
    generationWarning: imageWarning,
    seoScore: seo.score,
    seoChecks: seo.checks,
    characterCount: seo.characterCount,
    publishHistory: []
  });
  await incrementDailyUsage();
  return draft;
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    phase: job.phase || null,
    attempts: Number(job.attempts || 0),
    resumed: Boolean(job.resumed),
    warning: job.warning || null,
    draftId: job.draftId || null,
    error: job.error || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function saveJobState() {
  persistGenerationJobs(generationJobs).catch((error) => console.error("Generation job persistence failed:", error));
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  saveJobState();
}

async function runGenerationJob(job, input, { resumed = false } = {}) {
  if (!job || job.workerActive || ["completed", "canceled"].includes(job.status)) return;
  job.workerActive = true;
  job.input = input || job.input;
  job.attempts = Number(job.attempts || 0) + 1;
  job.resumed = resumed || Boolean(job.resumed);
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    if (job.status !== "running") return;
    job.updatedAt = new Date().toISOString();
    job.elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    saveJobState();
  }, 15000);
  heartbeat.unref();

  try {
    updateJob(job, {
      status: "running",
      progress: Math.max(5, Number(job.progress || 0)),
      phase: "starting",
      error: null,
      message: resumed ? "서버 재시작 후 생성 작업을 자동으로 이어서 시작했습니다." : "생성 작업을 시작했습니다."
    });
    const draft = await generateDraft(job.input, (progress, message, phase) => {
      if (job.status === "canceled") throw new Error("사용자가 생성 작업을 중단했습니다.");
      updateJob(job, { progress, message, phase });
    });
    if (job.status === "canceled") return;
    updateJob(job, {
      status: "completed",
      progress: 100,
      phase: "completed",
      message: draft.generationWarning ? "글 생성은 완료됐지만 이미지 일부를 확인해 주세요." : "글과 이미지 생성이 완료되었습니다.",
      warning: draft.generationWarning || null,
      draftId: draft.id
    });
  } catch (error) {
    console.error(error);
    if (job.status === "canceled") return;
    const message = error?.response?.data?.error?.message || error.message || "생성 중 오류가 발생했습니다.";
    updateJob(job, { status: "failed", phase: "failed", message, error: message });
  } finally {
    clearInterval(heartbeat);
    job.workerActive = false;
    saveJobState();
  }
}

setInterval(() => {
  const cutoff = Date.now() - 1000 * 60 * 60 * 24;
  let changed = false;
  for (const [id, job] of generationJobs.entries()) {
    if (new Date(job.updatedAt).getTime() < cutoff && ["completed", "failed", "canceled"].includes(job.status)) {
      generationJobs.delete(id);
      changed = true;
    }
  }
  if (changed) saveJobState();
}, 1000 * 60 * 20).unref();

app.get("/api/status", async (req, res) => {
  const usage = await getDailyUsage();
  const dailyLimit = Math.max(1, Number(process.env.DAILY_GENERATION_LIMIT || 10));
  const googleConfig = await getGoogleConfigStatus();
  res.json({
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    googleConfigured: googleConfig.configured,
    googleConfigSource: googleConfig.source,
    googleConnected: await isGoogleConnected(),
    imageHostConfigured: imageHostConfigured(),
    imageHostMode: process.env.IMAGE_HOST_MODE || "public",
    textModel: process.env.OPENAI_TEXT_MODEL || "gpt-5.6",
    imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    currentDate: koreaDate(),
    googleRedirectUri: getGoogleRedirectUri(),
    dailyUsage: usage.count,
    dailyLimit
  });
});

app.get("/api/models", async (req, res) => res.json({ models: await listAvailableTextModels(), defaultModel: process.env.OPENAI_TEXT_MODEL || "gpt-5.6" }));
app.get("/api/google/config", async (req, res) => res.json(await getGoogleConfigStatus()));
app.post("/api/google/config", async (req, res) => {
  const oauthJson = req.body?.oauthJson;
  if (!oauthJson) return res.status(400).json({ error: "Google OAuth JSON 파일 내용이 없습니다." });
  const result = await saveGoogleConfigFromJson(oauthJson);
  res.json(result);
});
app.delete("/api/google/config", async (req, res) => { await clearGoogleConfig(); res.json({ ok: true }); });

app.get("/auth/google", async (req, res, next) => {
  try { res.redirect(await createGoogleAuthUrl(req.session)); } catch (error) { next(error); }
});
app.get("/auth/google/callback", async (req, res) => {
  try { await handleGoogleCallback(req.query.code, req.query.state, req.session); res.redirect("/?google=connected"); }
  catch (error) { res.redirect(`/?google=error&message=${encodeURIComponent(error.message)}`); }
});
app.post("/api/google/disconnect", async (req, res) => { await disconnectGoogle(); res.json({ ok: true }); });
app.get("/api/blogs", async (req, res) => res.json({ blogs: await listBlogs() }));
app.post("/api/blogs/lookup", async (req, res) => {
  const url = safeText(req.body?.url, 500);
  const blog = await lookupBlogByUrl(url);
  res.json({ blog });
});
app.get("/api/drafts", async (req, res) => res.json({ drafts: await listDrafts() }));
app.get("/api/drafts/:id", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  res.json({ draft: withPreview(draft) });
});
app.put("/api/drafts/:id", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const article = {
    ...draft.article,
    title: safeText(req.body.title, 120) || draft.article.title,
    meta_description: safeText(req.body.meta_description, 220) || draft.article.meta_description,
    labels: Array.isArray(req.body.labels) ? req.body.labels.map((label) => safeText(label, 50)).filter(Boolean).slice(0, 8) : draft.article.labels,
    body_html: sanitizeArticleHtml(String(req.body.body_html || draft.article.body_html))
  };
  const seo = seoScore(article, draft.input?.targetKeyword, draft.images?.length || 0);
  const saved = await saveDraft({ ...draft, article, seoScore: seo.score, seoChecks: seo.checks });
  res.json({ draft: withPreview(saved) });
});
app.delete("/api/drafts/:id", async (req, res) => {
  const removed = await deleteDraft(req.params.id);
  res.status(removed ? 200 : 404).json({ ok: removed });
});

app.post("/api/generation-jobs", async (req, res) => {
  const usage = await getDailyUsage();
  const dailyLimit = Math.max(1, Number(process.env.DAILY_GENERATION_LIMIT || 10));
  const activeJobs = [...generationJobs.values()].filter((job) => ["queued", "running"].includes(job.status)).length;
  if (usage.count + activeJobs >= dailyLimit) return res.status(429).json({ error: `오늘 생성 한도(${dailyLimit}회)에 도달했습니다.` });
  const input = buildGenerationInput(req.body);
  if (!input.topic) return res.status(400).json({ error: "주제를 입력해 주세요." });
  const now = new Date().toISOString();
  const job = {
    id: crypto.randomUUID(),
    status: "queued",
    progress: 1,
    phase: "queued",
    attempts: 0,
    input,
    message: "생성 대기 중입니다.",
    createdAt: now,
    updatedAt: now
  };
  generationJobs.set(job.id, job);
  await persistGenerationJobs(generationJobs);
  res.status(202).json({ job: publicJob(job) });
  setImmediate(() => runGenerationJob(job, input));
});
app.get("/api/generation-jobs/:id", (req, res) => {
  const job = generationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "생성 작업 기록을 찾을 수 없습니다. 새 작업을 시작해 주세요." });
  res.json({ job: publicJob(job) });
});
app.post("/api/generation-jobs/:id/retry", async (req, res) => {
  const job = generationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "다시 시작할 생성 작업을 찾을 수 없습니다." });
  if (!job.input) return res.status(409).json({ error: "이 작업에는 다시 시작할 입력 정보가 없습니다." });
  if (["queued", "running"].includes(job.status)) return res.json({ job: publicJob(job) });
  updateJob(job, { status: "queued", progress: 1, phase: "queued", message: "생성 작업을 다시 준비하고 있습니다.", error: null, warning: null, draftId: null });
  res.status(202).json({ job: publicJob(job) });
  setImmediate(() => runGenerationJob(job, job.input));
});
app.delete("/api/generation-jobs/:id", async (req, res) => {
  const job = generationJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "중단할 생성 작업을 찾을 수 없습니다." });
  updateJob(job, { status: "canceled", phase: "canceled", message: "생성 작업을 중단했습니다.", error: null });
  res.json({ job: publicJob(job) });
});

// 이전 화면과의 호환성을 위한 동기식 생성 경로
app.post("/api/generate", async (req, res) => {
  const usage = await getDailyUsage();
  const dailyLimit = Math.max(1, Number(process.env.DAILY_GENERATION_LIMIT || 10));
  if (usage.count >= dailyLimit) return res.status(429).json({ error: `오늘 생성 한도(${dailyLimit}회)에 도달했습니다.` });
  const input = buildGenerationInput(req.body);
  if (!input.topic) return res.status(400).json({ error: "주제를 입력해 주세요." });
  const draft = await generateDraft(input);
  res.json({ draft: withPreview(draft) });
});

app.post("/api/publish", async (req, res) => {
  const draft = await getDraft(req.body.draftId);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const blogId = safeText(req.body.blogId, 100);
  if (!blogId) return res.status(400).json({ error: "발행할 블로그를 선택해 주세요." });
  const publishWithoutImages = Boolean(req.body.publishWithoutImages);
  let images = draft.images || [];
  if (images.length && !publishWithoutImages) images = await hostImages(images, draft.id);
  let content = draft.article.body_html;
  if (!publishWithoutImages) content = replaceImageMarkers(content, images, "hostedUrl");
  else content = content.replace(/<p>\{\{IMAGE_\d+\}\}<\/p>/g, "").replace(/\{\{IMAGE_\d+\}\}/g, "");
  content = sanitizeArticleHtml(appendExtras(draft.article, content));
  const result = await publishPost({ blogId, title: draft.article.title, content, labels: draft.article.labels, isDraft: Boolean(req.body.isDraft) });
  const saved = await saveDraft({ ...draft, images, publishHistory: [...(draft.publishHistory || []), { ...result, blogId, publishedAt: new Date().toISOString() }] });
  res.json({ result, draft: withPreview(saved) });
});

app.use((error, req, res, next) => {
  console.error(error);
  const message = error?.response?.data?.error?.message || error.message || "처리 중 오류가 발생했습니다.";
  res.status(error.status || 500).json({ error: message });
});

for (const job of generationJobs.values()) {
  if (!["queued", "running"].includes(job.status)) continue;
  if (!job.input) {
    updateJob(job, { status: "failed", phase: "failed", message: "서버 재시작 후 입력 정보를 복원하지 못했습니다. 새 작업을 시작해 주세요.", error: "입력 정보 복원 실패" });
    continue;
  }
  if (Number(job.attempts || 0) >= 3) {
    updateJob(job, { status: "failed", phase: "failed", message: "서버 재시작이 반복되어 자동 재개를 중단했습니다. 다시 시도 버튼을 눌러 주세요.", error: "자동 재개 횟수 초과" });
    continue;
  }
  setImmediate(() => runGenerationJob(job, job.input, { resumed: true }));
}

app.listen(PORT, () => console.log(`Blogger AI Auto Publisher: http://localhost:${PORT}`));
