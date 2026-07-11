import OpenAI from "openai";
import { saveGeneratedImage } from "./storage.js";

const ARTICLE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "meta_description", "slug", "excerpt", "labels", "body_html", "faq", "image_prompts", "sources", "risk_notice"],
  properties: {
    title: { type: "string" }, meta_description: { type: "string" }, slug: { type: "string" }, excerpt: { type: "string" }, body_html: { type: "string" }, risk_notice: { type: "string" },
    labels: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
    faq: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } } },
    image_prompts: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, required: ["prompt", "alt", "caption"], properties: { prompt: { type: "string" }, alt: { type: "string" }, caption: { type: "string" } } } },
    sources: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } } }
  }
};

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 360000),
    maxRetries: 1
  });
}
function textModel() { return process.env.OPENAI_TEXT_MODEL || "gpt-5.6"; }
function clamp(value, min, max) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min; }
function normalizeArticle(article, imageCount) {
  const normalized = {
    ...article,
    title: String(article.title || "").trim(), meta_description: String(article.meta_description || "").trim(), slug: String(article.slug || "").trim(), excerpt: String(article.excerpt || "").trim(), body_html: String(article.body_html || "").trim(),
    labels: [...new Set((article.labels || []).map((label) => String(label).trim()).filter(Boolean))].slice(0, 8), faq: Array.isArray(article.faq) ? article.faq.slice(0, 6) : [],
    sources: Array.isArray(article.sources) ? article.sources.filter((source) => /^https?:\/\//i.test(source?.url || "")).slice(0, 12) : [],
    image_prompts: Array.isArray(article.image_prompts) ? article.image_prompts.slice(0, imageCount) : [], risk_notice: String(article.risk_notice || "").trim()
  };
  for (let i = 0; i < normalized.image_prompts.length; i += 1) {
    const marker = `{{IMAGE_${i + 1}}}`;
    if (!normalized.body_html.includes(marker)) {
      const sections = [...normalized.body_html.matchAll(/<\/h2>/gi)];
      if (sections[i]) { const insertAt = sections[i].index + sections[i][0].length; normalized.body_html = `${normalized.body_html.slice(0, insertAt)}\n<p>${marker}</p>\n${normalized.body_html.slice(insertAt)}`; }
      else normalized.body_html += `\n<p>${marker}</p>`;
    }
  }
  return normalized;
}
function articlePrompt({ topic, targetKeyword, audience, tone, language, articleLength, imageCount, customInstructions, useWebResearch }) {
  return `당신은 검색 사용자의 문제를 실제로 해결하는 전문 편집자다. 아래 조건으로 Blogger에 바로 넣을 수 있는 고품질 글을 작성하라.\n\n[입력]\n- 주제: ${topic}\n- 핵심 키워드: ${targetKeyword || topic}\n- 독자: ${audience || "일반 독자"}\n- 문체: ${tone || "신뢰감 있고 쉽게 설명하는 문체"}\n- 언어: ${language || "한국어"}\n- 목표 분량: 약 ${articleLength}자\n- 본문 이미지 수: ${imageCount}개\n- 추가 지시: ${customInstructions || "없음"}\n- 최신 자료 조사: ${useWebResearch ? "필수" : "불필요"}\n\n[품질 원칙]\n1. 검색 의도를 첫 문단에서 바로 해결하고 반복을 피한다.\n2. 경험·비교·체크리스트·실행 단계처럼 바로 활용할 고유한 가치를 넣는다.\n3. 제목은 과장 없이 구체적으로 작성하고 핵심 키워드를 자연스럽게 포함한다.\n4. body_html은 완성된 HTML 조각이다. h1은 쓰지 말고 h2, h3, p, ul, ol, table, blockquote, strong, a를 사용한다.\n5. 이미지 위치에는 정확히 {{IMAGE_1}} 형식의 마커를 각각 한 번만 넣는다.\n6. 이미지 프롬프트에는 글자, 로고, 워터마크를 넣지 말고 16:9 블로그 이미지 구도와 조명을 구체적으로 쓴다.\n7. 웹 조사를 했다면 sources에 실제 확인한 신뢰도 높은 URL만 넣는다.\n8. 건강·법률·세무·보험·투자 주제는 단정하지 말고 risk_notice에 주의 문구를 쓴다.\n9. 존재하지 않는 통계, 기관, 법령, 사양, 인용문을 만들지 않는다.\n10. 상투적 자동생성 문구, 키워드 반복, 애드센스 클릭 유도를 금지한다.\n11. FAQ는 실제 후속 질문 중심으로 쓴다.\n12. 메타 설명은 약 80~155자, 제목은 가능하면 28~60자다.\n\n반드시 지정된 JSON 스키마만 반환하라.`;
}
export async function generateArticle(options) {
  const client = getClient(); const imageCount = clamp(options.imageCount, 0, 4); const articleLength = clamp(options.articleLength, 1200, 12000); const useWebResearch = Boolean(options.useWebResearch);
  const request = {
    model: textModel(),
    reasoning: { effort: "low" },
    instructions: "정확성, 유용성, 독창성, 사람의 최종 검수를 우선하는 편집 시스템이다.",
    input: articlePrompt({ ...options, imageCount, articleLength, useWebResearch }),
    max_output_tokens: 12000,
    text: { format: { type: "json_schema", name: "blog_article", strict: true, schema: ARTICLE_SCHEMA } }
  };
  if (useWebResearch) { request.tools = [{ type: "web_search", search_context_size: "low" }]; request.tool_choice = "required"; }
  const response = await client.responses.create(request); if (!response.output_text) throw new Error("글 생성 결과가 비어 있습니다.");
  try { return normalizeArticle(JSON.parse(response.output_text), imageCount); } catch { throw new Error("AI가 반환한 글 데이터를 해석하지 못했습니다. 다시 생성해 주세요."); }
}
export async function polishArticle(article, options) {
  const response = await getClient().responses.create({
    model: textModel(), reasoning: { effort: "low" },
    instructions: "실제 독자에게 도움이 되는 글만 통과시키는 엄격한 편집장이다.",
    input: `다음 글 JSON을 검수하고 개선하라. 불확실한 내용은 삭제하거나 신중하게 고치고 출처 URL과 이미지 마커를 보존하라. 목표 언어는 ${options.language || "한국어"}다.\n\n${JSON.stringify(article)}`,
    max_output_tokens: 12000,
    text: { format: { type: "json_schema", name: "polished_blog_article", strict: true, schema: ARTICLE_SCHEMA } }
  });
  if (!response.output_text) return article; try { return normalizeArticle(JSON.parse(response.output_text), article.image_prompts.length); } catch { return article; }
}
export async function generateImages(imagePrompts) {
  const client = getClient(); const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  return Promise.all(imagePrompts.map(async (item, index) => {
    const result = await client.images.generate({ model, prompt: `${item.prompt}\nProfessional editorial blog photography, landscape 16:9 composition, no text, no logo, no watermark, culturally natural and visually credible.`, size: "1536x1024", quality: process.env.OPENAI_IMAGE_QUALITY || "medium", output_format: "webp", output_compression: 82, n: 1 });
    const b64 = result.data?.[0]?.b64_json; if (!b64) throw new Error(`${index + 1}번째 이미지 생성 결과가 비어 있습니다.`);
    const filename = await saveGeneratedImage(Buffer.from(b64, "base64"), "webp");
    return { index: index + 1, filename, localUrl: `/generated/${filename}`, alt: item.alt, caption: item.caption, prompt: item.prompt };
  }));
}
