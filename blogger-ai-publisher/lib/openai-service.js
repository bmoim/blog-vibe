import OpenAI from "openai";
import { saveGeneratedImage } from "./storage.js";
import { cleanArticleOutput } from "./article-cleanup.js";

const ARTICLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "meta_description", "slug", "excerpt", "labels", "body_html", "faq", "image_prompts", "sources", "risk_notice"],
  properties: {
    title: { type: "string" },
    meta_description: { type: "string" },
    slug: { type: "string" },
    excerpt: { type: "string" },
    body_html: { type: "string" },
    risk_notice: { type: "string" },
    labels: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
    faq: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer"],
        properties: { question: { type: "string" }, answer: { type: "string" } }
      }
    },
    image_prompts: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "alt", "caption"],
        properties: { prompt: { type: "string" }, alt: { type: "string" }, caption: { type: "string" } }
      }
    },
    sources: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url"],
        properties: { title: { type: "string" }, url: { type: "string" } }
      }
    }
  }
};

const REQUEST_TIMEOUT_MS = Math.max(60000, Math.min(210000, Number(process.env.OPENAI_TIMEOUT_MS || 150000)));
const IMAGE_TIMEOUT_MS = Math.max(60000, Math.min(180000, Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 120000)));
let modelCache = { expiresAt: 0, ids: [] };

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 0
  });
}

function configuredTextModel() {
  const configured = String(process.env.OPENAI_TEXT_MODEL || "gpt-5.6").trim();
  return configured === "gpt-5.6-terra" ? "gpt-5.6" : configured;
}

function isGeneralTextModel(id) {
  return /^gpt-5(?:[.\w-]*)?$/i.test(id) && !/(audio|realtime|transcribe|tts|image|search|codex|embedding|moderation)/i.test(id);
}

function isImageModel(id) {
  return /^(?:gpt-image|chatgpt-image)/i.test(id);
}

async function availableModelIds(client = getClient()) {
  if (modelCache.expiresAt > Date.now() && modelCache.ids.length) return modelCache.ids;
  try {
    const page = await client.models.list({}, { timeout: 30000, maxRetries: 0 });
    const ids = [...new Set((page.data || []).map((model) => String(model.id || "")).filter(Boolean))];
    modelCache = { expiresAt: Date.now() + 1000 * 60 * 10, ids };
    return ids;
  } catch {
    return [];
  }
}

function sortGeneralModels(ids) {
  return [...ids].sort((a, b) => {
    const aMini = /mini|nano/i.test(a) ? 1 : 0;
    const bMini = /mini|nano/i.test(b) ? 1 : 0;
    if (aMini !== bMini) return aMini - bMini;
    return b.localeCompare(a, "en", { numeric: true });
  });
}

async function textModelCandidates(requested) {
  const client = getClient();
  const available = (await availableModelIds(client)).filter(isGeneralTextModel).filter((id) => !/-\d{4}-\d{2}-\d{2}$/.test(id));
  const preferred = [String(requested || "").trim(), configuredTextModel()].filter(Boolean);
  if (!available.length) return [...new Set(preferred)];
  return [...new Set([...preferred.filter((id) => available.includes(id)), ...sortGeneralModels(available)])];
}

async function imageModelCandidates() {
  const client = getClient();
  const configured = String(process.env.OPENAI_IMAGE_MODEL || "gpt-image-2").trim();
  const available = (await availableModelIds(client)).filter(isImageModel);
  if (!available.length) return [configured];
  return [...new Set([configured, ...available].filter((id) => available.includes(id)))];
}

export async function listAvailableTextModels() {
  const candidates = await textModelCandidates(configuredTextModel());
  return candidates.length ? candidates : [configuredTextModel()];
}

function koreaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function defaultThumbnailPrompt(article) {
  const labels = Array.isArray(article.labels) ? article.labels.slice(0, 4).join(", ") : "핵심 정보, 비교, 가이드, 체크포인트";
  return {
    prompt: `Create a premium Korean blog main thumbnail as a 1:1 square infographic. Bright white or very light gray background, deep royal blue to violet accents, very large bold Korean headline on the left, rounded blue badge at top-left, realistic topic-related hero visual at upper-right, thin divider, three rounded information cards across the lower middle, and a bottom strip with four small blue outline icons. Exact main headline: "${article.title}". Supporting line: "${article.meta_description}". Use these short content themes for cards and highlights: ${labels}. Clean commercial Korean blog thumbnail, strong hierarchy, soft shadows, no brand logo, no watermark, no random English, no invented numbers or claims. Korean text must be readable and correctly spelled.`,
    alt: `${article.title} 대표 썸네일`,
    caption: article.meta_description || article.excerpt || "블로그 대표 썸네일"
  };
}

function defaultBodyPrompt(article, index) {
  return {
    prompt: `Editorial Korean blog photograph illustrating ${article.title}. Visualize practical step ${index} with realistic objects, natural Korean setting, clean composition, trustworthy documentary lighting, landscape 16:9, no text, no logo, no watermark.`,
    alt: `${article.title} 본문 이미지 ${index}`,
    caption: `${article.title} 핵심 내용을 이해하기 위한 참고 이미지`
  };
}

function normalizeArticle(rawArticle, bodyImageCount) {
  const article = cleanArticleOutput(rawArticle);
  const desiredTotal = clamp(bodyImageCount, 0, 4) + 1;
  const rawPrompts = Array.isArray(article.image_prompts) ? article.image_prompts.slice(0, desiredTotal) : [];
  const thumbnail = defaultThumbnailPrompt(article);
  const prompts = [{
    ...thumbnail,
    prompt: `${thumbnail.prompt}\nAdditional visual context: ${String(rawPrompts[0]?.prompt || "").slice(0, 1200)}`,
    caption: String(rawPrompts[0]?.caption || thumbnail.caption)
  }];
  for (let index = 1; index < desiredTotal; index += 1) {
    prompts.push(rawPrompts[index] || defaultBodyPrompt(article, index));
  }

  const normalized = {
    ...article,
    title: String(article.title || "").trim(),
    meta_description: String(article.meta_description || "").trim(),
    slug: String(article.slug || "").trim(),
    excerpt: String(article.excerpt || "").trim(),
    body_html: String(article.body_html || "").trim(),
    labels: [...new Set((article.labels || []).map((label) => String(label).trim()).filter(Boolean))].slice(0, 8),
    faq: Array.isArray(article.faq) ? article.faq.slice(0, 6) : [],
    sources: Array.isArray(article.sources) ? article.sources.filter((source) => /^https?:\/\//i.test(source?.url || "")).slice(0, 12) : [],
    image_prompts: prompts,
    risk_notice: String(article.risk_notice || "").trim()
  };

  normalized.body_html = normalized.body_html.replace(/(?:<p>)?\{\{IMAGE_1\}\}(?:<\/p>)?/gi, "").trim();
  normalized.body_html = `<p>{{IMAGE_1}}</p>\n${normalized.body_html}`;
  for (let index = 1; index < normalized.image_prompts.length; index += 1) {
    const marker = `{{IMAGE_${index + 1}}}`;
    if (normalized.body_html.includes(marker)) continue;
    const sections = [...normalized.body_html.matchAll(/<\/h2>/gi)];
    const section = sections[index - 1];
    if (section) {
      const insertAt = section.index + section[0].length;
      normalized.body_html = `${normalized.body_html.slice(0, insertAt)}\n<p>${marker}</p>\n${normalized.body_html.slice(insertAt)}`;
    } else {
      normalized.body_html += `\n<p>${marker}</p>`;
    }
  }
  return normalized;
}

function freshnessRules(currentDate) {
  return `\n[현재 시점과 최신성 규칙]\n- 오늘 날짜는 대한민국 시간 기준 ${currentDate}이다.\n- 가격, 지원금, 신청 기간, 법령, 제도, 제품 사양, 인물·직책, 의료·금융 정보처럼 바뀔 수 있는 사실은 현재 유효한지 확인한다.\n- 오래된 자료를 현재 정보처럼 쓰지 않는다.\n- 가능하면 공식 기관·제조사·정부·원문 자료를 우선한다.\n- 최신 정보가 확인되지 않으면 임의로 채우지 말고 확인 방법과 불확실성을 명시한다.`;
}

function articlePrompt({ topic, targetKeyword, audience, tone, language, articleLength, imageCount, customInstructions, currentDate }) {
  return `당신은 검색 사용자의 문제를 실제로 해결하는 전문 편집자다. 아래 조건으로 Blogger에 바로 넣을 수 있는 고품질 글을 작성하라.\n\n[입력]\n- 주제: ${topic}\n- 핵심 키워드: ${targetKeyword || topic}\n- 독자: ${audience || "일반 독자"}\n- 문체: ${tone || "신뢰감 있고 쉽게 설명하는 문체"}\n- 언어: ${language || "한국어"}\n- 목표 분량: 약 ${articleLength}자\n- 본문 이미지 수: ${imageCount}개\n- 별도 대표 썸네일: 1:1 정사각형 1장 필수\n- 추가 지시: ${customInstructions || "없음"}\n${freshnessRules(currentDate)}\n\n[품질 원칙]\n1. 검색 의도를 첫 문단에서 바로 해결하고 반복을 피한다.\n2. 경험·비교·체크리스트·실행 단계처럼 바로 활용할 고유한 가치를 넣는다.\n3. 제목은 과장 없이 구체적으로 작성하고 핵심 키워드를 자연스럽게 포함한다.\n4. body_html은 완성된 HTML 조각이다. h1은 쓰지 말고 h2, h3, p, ul, ol, table, blockquote, strong, a를 사용한다.\n5. image_prompts의 첫 항목은 1:1 대표 썸네일이고 나머지는 본문 이미지다. 전체 수는 ${imageCount + 1}개다.\n6. body_html 첫 부분에 {{IMAGE_1}}을 정확히 한 번 넣고 본문 이미지는 {{IMAGE_2}}부터 순서대로 넣는다.\n7. sources에는 실제 확인한 신뢰도 높은 URL만 넣고 본문에는 괄호형 출처 링크나 utm_source=openai 추적 주소를 넣지 않는다.\n8. 건강·법률·세무·보험·투자 주제는 단정하지 말고 risk_notice에 주의 문구를 쓴다.\n9. 존재하지 않는 통계, 기관, 법령, 사양, 인용문을 만들지 않는다.\n10. FAQ는 실제 후속 질문 중심으로 쓴다.\n11. 메타 설명은 약 80~155자, 제목은 가능하면 28~60자다.\n\n반드시 지정된 JSON 스키마만 반환하라.`;
}

function outputTokenLimit(articleLength) {
  return Math.max(4500, Math.min(9000, Math.ceil(Number(articleLength || 2800) * 1.6)));
}

function isAccessOrQuotaError(error) {
  return [401, 403, 429].includes(Number(error?.status || error?.response?.status || 0));
}

async function createStructuredResponse({ requestedModel, instructions, input, schemaName, maxOutputTokens, useWebSearch }) {
  const client = getClient();
  const models = await textModelCandidates(requestedModel);
  let lastError = null;
  for (const model of models) {
    try {
      const request = {
        model,
        reasoning: { effort: "low" },
        instructions,
        input,
        max_output_tokens: maxOutputTokens,
        text: { format: { type: "json_schema", name: schemaName, strict: true, schema: ARTICLE_SCHEMA } }
      };
      if (useWebSearch) {
        request.tools = [{ type: "web_search", search_context_size: "low" }];
        request.tool_choice = "auto";
      }
      const response = await client.responses.create(request, { timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
      if (!response.output_text) throw new Error("글 생성 결과가 비어 있습니다.");
      return { response, model };
    } catch (error) {
      lastError = error;
      if (isAccessOrQuotaError(error)) throw error;
      console.error(`Text generation failed with ${model}:`, error.message);
    }
  }
  throw lastError || new Error("사용 가능한 글 작성 모델을 찾지 못했습니다.");
}

export async function generateArticle(options) {
  const imageCount = clamp(options.imageCount, 0, 4);
  const articleLength = clamp(options.articleLength, 1200, 12000);
  const currentDate = options.currentDate || koreaDate();
  const common = {
    requestedModel: options.textModel,
    instructions: `정확성, 최신성, 유용성, 독창성, 사람의 최종 검수를 우선하는 한국어 편집 시스템이다. 오늘은 대한민국 시간 기준 ${currentDate}다.`,
    input: articlePrompt({ ...options, imageCount, articleLength, currentDate }),
    schemaName: "blog_article",
    maxOutputTokens: outputTokenLimit(articleLength)
  };

  let warning = "";
  let result;
  try {
    result = await createStructuredResponse({ ...common, useWebSearch: true });
  } catch (error) {
    if (isAccessOrQuotaError(error)) throw error;
    warning = `최신 웹 조사 연결이 지연되어 글을 우선 생성했습니다. 발행 전 최신 날짜·가격·제도는 다시 확인해 주세요. (${error.message})`;
    result = await createStructuredResponse({ ...common, useWebSearch: false });
  }

  try {
    const article = normalizeArticle(JSON.parse(result.response.output_text), imageCount);
    if (warning) article.generation_warning = warning;
    article.generated_with_model = result.model;
    return article;
  } catch {
    throw new Error("AI가 반환한 글 데이터를 해석하지 못했습니다. 다시 생성해 주세요.");
  }
}

export async function polishArticle(article, options) {
  const currentDate = options.currentDate || koreaDate();
  try {
    const result = await createStructuredResponse({
      requestedModel: options.textModel,
      instructions: `실제 독자에게 도움이 되는 글만 통과시키는 최신성 검증 편집장이다. 오늘은 대한민국 시간 기준 ${currentDate}다.`,
      input: `다음 글 JSON을 검수하고 중복, 문장 품질, 구조, 검색 의도를 개선하라. 불확실하거나 현재와 맞지 않는 내용은 삭제·수정하고 이미지 마커와 대표 썸네일 지시는 보존하라. 본문에는 괄호형 출처 링크나 utm_source=openai 주소를 넣지 말고 출처는 sources 배열에만 기록하라.${freshnessRules(currentDate)}\n목표 언어는 ${options.language || "한국어"}다.\n\n${JSON.stringify(article)}`,
      schemaName: "reviewed_blog_article",
      maxOutputTokens: outputTokenLimit(options.articleLength),
      useWebSearch: false
    });
    const reviewed = normalizeArticle(JSON.parse(result.response.output_text), Math.max(0, article.image_prompts.length - 1));
    reviewed.generation_warning = article.generation_warning || "";
    reviewed.generated_with_model = result.model;
    return reviewed;
  } catch (error) {
    console.error("Premium review skipped:", error.message);
    return {
      ...cleanArticleOutput(article),
      generation_warning: [article.generation_warning, `2차 편집장 검수는 건너뛰고 첫 초안을 저장했습니다. (${error.message})`].filter(Boolean).join(" ")
    };
  }
}

function xmlEscape(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

function wrapKoreanText(value, width = 14, maxLines = 3) {
  const text = String(value || "대표 썸네일").replace(/\s+/g, " ").trim();
  const lines = [];
  let current = "";
  for (const word of text.split(" ")) {
    if (!current) current = word;
    else if ((current + word).length + 1 <= width) current += ` ${word}`;
    else { lines.push(current); current = word; }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.slice(0, maxLines);
}

async function fallbackThumbnail(item) {
  const title = String(item.alt || "블로그 대표 썸네일").replace(/대표 썸네일/g, "").trim() || "블로그 핵심 가이드";
  const caption = String(item.caption || "핵심 내용을 한눈에 확인하세요").slice(0, 80);
  const lines = wrapKoreanText(title);
  const titleSvg = lines.map((line, index) => `<text x="88" y="${265 + index * 92}" font-family="Arial, sans-serif" font-size="66" font-weight="800" fill="#111827">${xmlEscape(line)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="1024" height="1024" rx="42" fill="#f8fafc"/><rect x="64" y="64" width="220" height="58" rx="29" fill="url(#g)"/><text x="174" y="102" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#fff">핵심 정보</text>${titleSvg}<rect x="88" y="590" width="848" height="3" fill="#dbe1ea"/><text x="88" y="650" font-family="Arial, sans-serif" font-size="27" fill="#475569">${xmlEscape(caption)}</text><g transform="translate(88 725)"><rect width="258" height="150" rx="24" fill="#eef2ff"/><rect x="286" width="258" height="150" rx="24" fill="#f3e8ff"/><rect x="572" width="258" height="150" rx="24" fill="#eff6ff"/><circle cx="55" cy="48" r="20" fill="#4f46e5"/><circle cx="341" cy="48" r="20" fill="#7c3aed"/><circle cx="627" cy="48" r="20" fill="#2563eb"/><text x="28" y="105" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#334155">확인</text><text x="314" y="105" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#334155">비교</text><text x="600" y="105" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#334155">실행</text></g><text x="88" y="952" font-family="Arial, sans-serif" font-size="23" fill="#64748b">정확한 정보 · 쉬운 설명 · 바로 쓰는 체크리스트</text></svg>`;
  const filename = await saveGeneratedImage(Buffer.from(svg, "utf8"), "svg");
  return {
    index: 1,
    kind: "main-thumbnail",
    filename,
    localUrl: `/generated/${filename}`,
    alt: `${title} 대표 썸네일`,
    caption: item.caption || "블로그 대표 썸네일",
    prompt: item.prompt,
    fallback: true
  };
}

async function imageBufferFromResult(result) {
  const data = result.data?.[0];
  if (data?.b64_json) return Buffer.from(data.b64_json, "base64");
  if (data?.url) {
    const response = await fetch(data.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("이미지 다운로드에 실패했습니다.");
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("이미지 생성 결과가 비어 있습니다.");
}

async function generateOneImage(client, models, item, index) {
  const isThumbnail = index === 0;
  const prompt = isThumbnail
    ? `${item.prompt}\nSquare 1:1 premium Korean blog main thumbnail, crisp commercial infographic layout, readable Korean headline, blue-violet and white palette, realistic topic visual, three lower information cards, four-icon bottom strip, no watermark, no logo.`
    : `${item.prompt}\nProfessional editorial blog photography, landscape 16:9 composition, no text, no logo, no watermark, culturally natural and visually credible.`;
  let lastError = null;
  for (const model of models) {
    try {
      const result = await client.images.generate({
        model,
        prompt,
        size: isThumbnail ? "1024x1024" : "1536x1024",
        quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
        output_format: "webp",
        output_compression: 82,
        n: 1
      }, { timeout: IMAGE_TIMEOUT_MS, maxRetries: 0 });
      const buffer = await imageBufferFromResult(result);
      const filename = await saveGeneratedImage(buffer, "webp");
      return {
        index: index + 1,
        kind: isThumbnail ? "main-thumbnail" : "body-image",
        filename,
        localUrl: `/generated/${filename}`,
        alt: isThumbnail ? `${String(item.alt || "대표 썸네일").replace(/대표 썸네일/g, "").trim()} 대표 썸네일`.trim() : item.alt,
        caption: item.caption,
        prompt: item.prompt,
        model
      };
    } catch (error) {
      lastError = error;
      if (isAccessOrQuotaError(error)) throw error;
      console.error(`Image generation failed with ${model}:`, error.message);
    }
  }
  throw lastError || new Error("사용 가능한 이미지 모델을 찾지 못했습니다.");
}

export async function generateImages(imagePrompts, onProgress = () => {}) {
  const prompts = Array.isArray(imagePrompts) ? imagePrompts.slice(0, 5) : [];
  const client = getClient();
  const models = await imageModelCandidates();
  const images = [];
  const warnings = [];

  for (let index = 0; index < prompts.length; index += 1) {
    const item = prompts[index];
    onProgress(index, prompts.length, item);
    try {
      images.push(await generateOneImage(client, models, item, index));
    } catch (error) {
      const label = index === 0 ? "대표 썸네일" : `본문 이미지 ${index}`;
      warnings.push(`${label} AI 생성 실패: ${error.message}`);
      if (index === 0) {
        images.push(await fallbackThumbnail(item));
        warnings.push("대표 썸네일은 안전한 기본 디자인으로 대체했습니다.");
      }
    }
  }

  return { images, warnings };
}
