import express from "express";
import sanitizeHtml from "sanitize-html";
import { getDraft } from "./storage.js";
import { getGrowthSettings } from "./growth-storage.js";

const router = express.Router();

function stripHtml(value) {
  return sanitizeHtml(String(value || ""), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}

function duplicateSentenceRatio(text) {
  const sentences = stripHtml(text).split(/[.!?。！？]\s*/).map((item) => item.trim()).filter((item) => item.length >= 20);
  if (!sentences.length) return 0;
  const normalized = sentences.map((item) => item.replace(/\s+/g, " ").toLowerCase());
  return 1 - new Set(normalized).size / normalized.length;
}

function markerHealth(draft) {
  const markers = [...String(draft.article?.body_html || "").matchAll(/\{\{IMAGE_(\d+)\}\}/g)].map((match) => Number(match[1]));
  const imageIndexes = new Set((draft.images || []).map((image) => Number(image.index)).filter(Number.isFinite));
  const missing = [...new Set(markers.filter((index) => !imageIndexes.has(index)))];
  const duplicateMarkers = markers.filter((value, index) => markers.indexOf(value) !== index);
  return { markers, missing, duplicateMarkers: [...new Set(duplicateMarkers)] };
}

function staleYearRisk(article) {
  const currentYear = new Date().getFullYear();
  const text = `${article.title || ""} ${article.meta_description || ""} ${stripHtml(article.body_html).slice(0, 5000)}`;
  const years = [...new Set((text.match(/20\d{2}/g) || []).map(Number).filter((year) => year < currentYear))];
  const titleHasOldYear = years.some((year) => String(article.title || "").includes(String(year)));
  return { years, titleHasOldYear };
}

function qualityGate(draft, settings) {
  const article = draft.article || {};
  const body = stripHtml(article.body_html);
  const markers = markerHealth(draft);
  const stale = staleYearRisk(article);
  const images = draft.images || [];
  const allAlt = images.every((image) => String(image.alt || "").trim().length >= 4);
  const thumbnail = images.some((image) => image.kind === "main-thumbnail" || /대표 썸네일/.test(image.alt || ""));
  const checks = [];
  const add = (name, passed, weight, level, detail) => checks.push({ name, passed: Boolean(passed), weight, level, detail });

  add("제목 길이", article.title?.length >= 20 && article.title?.length <= 65, 9, "warning", "검색 결과에서 잘리지 않도록 20~65자를 권장합니다.");
  add("메타 설명", article.meta_description?.length >= 70 && article.meta_description?.length <= 165, 9, "warning", "70~165자의 구체적인 설명을 권장합니다.");
  add("충분한 본문", body.length >= 1200, 14, "blocker", `현재 본문은 약 ${body.length.toLocaleString("ko-KR")}자입니다.`);
  add("소제목 구조", /<h2[\s>]/i.test(article.body_html || ""), 7, "warning", "본문에 H2 소제목을 추가하세요.");
  add("목록 또는 표", /<(ul|ol|table)[\s>]/i.test(article.body_html || ""), 6, "warning", "체크리스트나 비교표를 추가하세요.");
  add("FAQ", Array.isArray(article.faq) && article.faq.length >= 2, 5, "warning", "실제 후속 질문을 2개 이상 넣으세요.");
  add("확인 가능한 출처", Array.isArray(article.sources) && article.sources.some((source) => /^https?:\/\//i.test(source?.url || "")), 14, "blocker", "공식 기관이나 원문 출처가 필요합니다.");
  add("대표 썸네일", thumbnail, 7, "warning", "1:1 대표 썸네일을 생성하세요.");
  add("이미지 마커 연결", markers.missing.length === 0 && markers.duplicateMarkers.length === 0, 10, "blocker", markers.missing.length ? `이미지가 없는 마커: ${markers.missing.join(", ")}` : markers.duplicateMarkers.length ? `중복 마커: ${markers.duplicateMarkers.join(", ")}` : "모든 이미지 마커가 정상입니다.");
  add("이미지 대체 텍스트", images.length === 0 || allAlt, 5, "warning", "모든 이미지에 의미 있는 대체 텍스트가 필요합니다.");
  add("중복 문장", duplicateSentenceRatio(article.body_html) < 0.12, 6, "warning", "반복되는 문장을 줄이세요.");
  add("작성자 신뢰도", Boolean(settings.author?.name && settings.author?.bio), 5, "warning", "성장 센터에서 작성자 이름과 소개를 저장하세요.");
  add("오래된 연도 제목 점검", !stale.titleHasOldYear, 5, "warning", stale.titleHasOldYear ? `제목에 과거 연도(${stale.years.join(", ")})가 있습니다. 현재 기준인지 확인하세요.` : "제목의 기준 연도가 정상입니다.");

  const totalWeight = checks.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.round(checks.reduce((sum, item) => sum + (item.passed ? item.weight : 0), 0) / totalWeight * 100);
  const blockers = checks.filter((item) => !item.passed && item.level === "blocker");
  return {
    score,
    pass: score >= 78 && blockers.length === 0,
    blockers,
    checks,
    diagnostics: {
      bodyCharacters: body.length,
      imageMarkers: markers.markers,
      staleYears: stale.years,
      duplicateSentenceRatio: Number(duplicateSentenceRatio(article.body_html).toFixed(3))
    }
  };
}

router.get("/drafts/:id/quality", async (req, res) => {
  const draft = await getDraft(req.params.id);
  if (!draft) return res.status(404).json({ error: "초안을 찾을 수 없습니다." });
  res.json({ quality: qualityGate(draft, await getGrowthSettings()) });
});

export function createQualityGateRouter() {
  return router;
}
