import "dotenv/config";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import session from "express-session";
import sessionFileStore from "session-file-store";
import sanitizeHtml from "sanitize-html";
import { generateArticle, generateImages, polishArticle } from "./lib/openai-service.js";
import { createGoogleAuthUrl, disconnectGoogle, handleGoogleCallback, isGoogleConnected, isGoogleConfigured, getGoogleConfigStatus, saveGoogleConfigFromJson, clearGoogleConfig, listBlogs, lookupBlogByUrl, publishPost, getGoogleRedirectUri } from "./lib/blogger-service.js";
import { deleteDraft, getDailyUsage, getDraft, incrementDailyUsage, listDrafts, saveDraft, generatedDirectory, dataDirectory } from "./lib/storage.js";
import { hostImages, imageHostConfigured } from "./lib/image-host.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const FileStore = sessionFileStore(session);

app.set("trust proxy", 1);
app.get("/health", (req, res) => res.json({ ok: true }));

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
app.use("/generated", express.static(generatedDirectory, { maxAge: "1h", fallthrough: true }));
app.use(express.static(path.join(ROOT, "public"), { maxAge: 0, etag: true }));

function safeText(value, max = 500) { return String(value || "").trim().slice(0, max); }

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
    imageHostMode: process.env.IMAGE_HOST_MODE || "cloudinary",
    textModel: process.env.OPENAI_TEXT_MODEL || "gpt-5.6",
    imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    googleRedirectUri: getGoogleRedirectUri(),
    dailyUsage: usage.count,
    dailyLimit
  });
});

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

app.post("/api/generate", async (req, res) => {
  const usage = await getDailyUsage();
  const dailyLimit = Math.max(1, Number(process.env.DAILY_GENERATION_LIMIT || 10));
  if (usage.count >= dailyLimit) return res.status(429).json({ error: `오늘 생성 한도(${dailyLimit}회)에 도달했습니다.` });
  const input = {
    topic: safeText(req.body.topic, 300), targetKeyword: safeText(req.body.targetKeyword, 150), audience: safeText(req.body.audience, 200),
    tone: safeText(req.body.tone, 200), language: safeText(req.body.language, 50) || "한국어", articleLength: Number(req.body.articleLength || 2500),
    imageCount: Number(req.body.imageCount ?? 2), customInstructions: safeText(req.body.customInstructions, 1500), useWebResearch: Boolean(req.body.useWebResearch), premiumReview: Boolean(req.body.premiumReview)
  };
  if (!input.topic) return res.status(400).json({ error: "주제를 입력해 주세요." });
  let article = await generateArticle(input);
  if (input.premiumReview) article = await polishArticle(article, input);
  const images = input.imageCount > 0 ? await generateImages(article.image_prompts) : [];
  const seo = seoScore(article, input.targetKeyword || input.topic, images.length);
  const draft = await saveDraft({ input, article, images, seoScore: seo.score, seoChecks: seo.checks, characterCount: seo.characterCount, publishHistory: [] });
  await incrementDailyUsage();
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

app.listen(PORT, () => console.log(`Blogger AI Auto Publisher: http://localhost:${PORT}`));
