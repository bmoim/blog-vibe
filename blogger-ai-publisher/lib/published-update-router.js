import express from "express";
import { google } from "googleapis";
import sanitizeHtml from "sanitize-html";
import {
  getDraft,
  saveDraft,
  readGoogleToken,
  saveGoogleToken,
  readGoogleOAuthConfig
} from "./storage.js";
import { getGoogleRedirectUri } from "./blogger-service.js";
import { hostImages } from "./image-host.js";
import { snapshotDraftVersion } from "./growth-storage.js";

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

function figureHtml(image, src) {
  const alt = sanitizeHtml(image.alt || "", { allowedTags: [], allowedAttributes: {} });
  const caption = sanitizeHtml(image.caption || "", { allowedTags: [], allowedAttributes: {} });
  return `<figure style="margin:28px 0;text-align:center"><img src="${src}" alt="${alt}" loading="lazy" style="max-width:100%;height:auto;border-radius:12px"><figcaption style="margin-top:8px;color:#666;font-size:.92em">${caption}</figcaption></figure>`;
}

function replaceImageMarkers(html, images, key) {
  let content = String(html || "");
  for (const image of images || []) {
    const marker = `{{IMAGE_${image.index}}}`;
    const src = image?.[key];
    if (!src) continue;
    content = content
      .replaceAll(`<p>${marker}</p>`, figureHtml(image, src))
      .replaceAll(marker, figureHtml(image, src));
  }
  return content.replace(/<p>\{\{IMAGE_\d+\}\}<\/p>/g, "").replace(/\{\{IMAGE_\d+\}\}/g, "");
}

function appendExtras(article, html) {
  let result = html;
  if (article.faq?.length) result += `<section><h2>자주 묻는 질문</h2>${article.faq.map((item) => `<h3>${sanitizeHtml(item.question, { allowedTags: [] })}</h3><p>${sanitizeHtml(item.answer, { allowedTags: ["strong", "em", "br"] })}</p>`).join("")}</section>`;
  if (article.sources?.length) result += `<section><h2>참고 자료</h2><ul>${article.sources.map((source) => `<li><a href="${source.url}" target="_blank" rel="nofollow noopener noreferrer">${sanitizeHtml(source.title, { allowedTags: [] })}</a></li>`).join("")}</ul></section>`;
  if (article.risk_notice) result += `<p style="padding:14px;background:#f5f5f5;border-radius:8px;color:#555"><strong>안내:</strong> ${sanitizeHtml(article.risk_notice, { allowedTags: [] })}</p>`;
  return result;
}

function latestPublishedRecord(draft) {
  const history = Array.isArray(draft?.publishHistory) ? draft.publishHistory : [];
  return [...history].reverse().find((item) => item?.id && item?.blogId && item?.status !== "DRAFT") || null;
}

router.get("/drafts/:id/published-status", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const record = latestPublishedRecord(draft);
  res.json({ published: Boolean(record), record });
});

router.post("/drafts/:id/update-published", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  const record = latestPublishedRecord(draft);
  if (!record) return res.status(400).json({ error: "이 초안에서 공개 발행한 Blogger 글 기록을 찾지 못했습니다." });

  await snapshotDraftVersion(draft, "before-published-update");
  let images = draft.images || [];
  if (images.length) images = await hostImages(images, draft.id);
  let content = replaceImageMarkers(draft.article.body_html, images, "hostedUrl");
  content = appendExtras(draft.article, content);

  const blogger = google.blogger({ version: "v3", auth: await googleAuthClient() });
  const response = await blogger.posts.update({
    blogId: record.blogId,
    postId: record.id,
    publish: true,
    revert: false,
    requestBody: {
      kind: "blogger#post",
      id: record.id,
      title: draft.article.title,
      content,
      labels: draft.article.labels
    }
  });

  const updateRecord = {
    id: response.data.id || record.id,
    blogId: record.blogId,
    title: response.data.title || draft.article.title,
    url: response.data.url || record.url || null,
    status: response.data.status || "LIVE",
    publishedAt: new Date().toISOString(),
    updatedExistingPost: true
  };
  const saved = await saveDraft({
    ...draft,
    images,
    publishHistory: [...(draft.publishHistory || []), updateRecord]
  });
  res.json({ result: updateRecord, draft: saved });
});

export function createPublishedUpdateRouter() {
  return router;
}
