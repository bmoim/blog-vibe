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
    faq: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } } },
    image_prompts: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["prompt", "alt", "caption"], properties: { prompt: { type: "string" }, alt: { type: "string" }, caption: { type: "string" } } } },
    sources: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } } }
  }
};

const TEXT_TIMEOUT = Math.max(60000, Math.min(120000, Number(process.env.OPENAI_TIMEOUT_MS || 90000)));
const IMAGE_TIMEOUT = Math.max(45000, Math.min(90000, Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 75000)));
let cachedModels = { expiresAt: 0, ids: [] };

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: TEXT_TIMEOUT, maxRetries: 0 });
}

function configuredTextModel() {
  const value = String(process.env.OPENAI_TEXT_MODEL || "gpt-5.6").trim();
  return value === "gpt-5.6-terra" ? "gpt-5.6" : value;
}

function validTextModel(id) {
  return /^gpt-5(?:[.\w-]*)?$/i.test(id) && !/(audio|realtime|transcribe|tts|image|search|codex|embedding|moderation)/i.test(id);
}

async function modelIds() {
  if (cachedModels.expiresAt > Date.now() && cachedModels.ids.length) return cachedModels.ids;
  try {
    const page = await client().models.list({}, { timeout: 20000, maxRetries: 0 });
    const ids = [...new Set((page.data || []).map((model) => String(model.id || "")).filter(Boolean))];
    cachedModels = { expiresAt: Date.now() + 600000, ids };
    return ids;
  } catch {
    return [];
  }
}

async function textCandidates(requested) {
  const available = (await modelIds()).filter(validTextModel).filter((id) => !/-\d{4}-\d{2}-\d{2}$/.test(id));
  const preferred = [String(requested || "").trim(), configuredTextModel()].filter(Boolean);
  if (!available.length) return [...new Set(preferred)];
  const ordered = [...available].sort((a, b) => {
    const miniDiff = Number(/mini|nano/i.test(a)) - Number(/mini|nano/i.test(b));
    return miniDiff || b.localeCompare(a, "en", { numeric: true });
  });
  return [...new Set([...preferred.filter((id) => available.includes(id)), ...ordered])];
}

export async function listAvailableTextModels() {
  const models = await textCandidates(configuredTextModel());
  return models.length ? models : [configuredTextModel()];
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function koreaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function thumbnailPrompt(article) {
  const labels = Array.isArray(article.labels) ? article.labels.slice(0, 4).join(", ") : "핵심 정보, 비교, 체크리스트";
  return {
    prompt: `Premium Korean blog main thumbnail, 1:1 square infographic, white and light gray background, deep blue and violet accents, very large bold Korean headline, small rounded badge, realistic subject visual, three rounded information cards and four small icons. Exact headline: "${article.title}". Supporting line: "${article.meta_description}". Themes: ${labels}. No logo, no watermark, no invented numbers, readable correctly spelled Korean text.`,
    alt: `${article.title} 대표 썸네일`,
    caption: article.meta_description || article.excerpt || "블로그 대표 썸네일"
  };
}

function bodyPrompt(article, index) {
  return {
    prompt: `Realistic Korean editorial blog photograph for ${article.title}, practical scene ${index}, trustworthy documentary lighting, landscape 16:9, no text, no logo, no watermark.`,
    alt: `${article.title} 본문 이미지 ${index}`,
    caption: `${article.title} 핵심 내용 참고 이미지`
  };
}

function normalizeArticle(raw, bodyCount) {
  const article = cleanArticleOutput(raw);
  const total = clamp(bodyCount, 0, 4) + 1;
  const rawPrompts = Array.isArray(article.image_prompts) ? article.image_prompts : [];
  const first = thumbnailPrompt(article);
  const prompts = [{ ...first, prompt: `${first.prompt}\n${String(rawPrompts[0]?.prompt || "").slice(0, 800)}` }];
  for (let index = 1; index < total; index += 1) prompts.push(rawPrompts[index] || bodyPrompt(article, index));

  const normalized = {
    ...article,
    title: String(article.title || "").trim(),
    meta_description: String(article.meta_description || "").trim(),
    slug: String(article.slug || "").trim(),
    excerpt: String(article.excerpt || "").trim(),
    body_html: String(article.body_html || "").trim(),
    labels: [...new Set((article.labels || []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 8),
    faq: Array.isArray(article.faq) ? article.faq.slice(0, 6) : [],
    sources: Array.isArray(article.sources) ? article.sources.filter((source) => /^https?:\/\//i.test(source?.url || "")).slice(0, 12) : [],
    image_prompts: prompts,
    risk_notice: String(article.risk_notice || "").trim()
  };

  normalized.body_html = normalized.body_html.replace(/(?:<p>)?\{\{IMAGE_1\}\}(?:<\/p>)?/gi, "").trim();
  normalized.body_html = `<p>{{IMAGE_1}}</p>\n${normalized.body_html}`;
  for (let index = 1; index < total; index += 1) {
    const marker = `{{IMAGE_${index + 1}}}`;
    if (!normalized.body_html.includes(marker)) normalized.body_html += `\n<p>${marker}</p>`;
  }
  return normalized;
}

function articlePrompt(options, currentDate, imageCount, articleLength) {
  return `한국어 전문 블로그 글을 JSON 스키마에 맞춰 작성하라.\n주제: ${options.topic}\n핵심 키워드: ${options.targetKeyword || options.topic}\n독자: ${options.audience || "일반 독자"}\n문체: ${options.tone || "신뢰감 있고 쉽게 설명하는 문체"}\n목표 분량: 약 ${articleLength}자\n본문 이미지: ${imageCount}장, 대표 썸네일: 1장\n추가 요청: ${options.customInstructions || "없음"}\n오늘 날짜: 대한민국 시간 ${currentDate}\n\n규칙:\n- 첫 문단에서 답을 바로 제시한다.\n- h1 없이 h2, h3, p, ul, ol, table을 활용한다.\n- 현재 가격, 제도, 법령, 지원금, 의료·금융 정보는 확인된 내용만 쓴다.\n- 불확실한 수치나 기관은 만들지 않는다.\n- 본문 첫 부분에 {{IMAGE_1}}, 나머지는 {{IMAGE_2}}부터 넣는다.\n- sources에는 실제 URL만 넣고 본문에 괄호형 출처나 utm_source=openai 문구를 쓰지 않는다.\n- 보험·건강·금융·법률 주제는 risk_notice를 작성한다.\n- 제목 28~60자, 메타 설명 80~155자.\n- image_prompts 첫 항목은 1:1 대표 썸네일, 나머지는 16:9 본문 이미지다.`;
}

function protectedError(error) {
  return [401, 403, 429].includes(Number(error?.status || error?.response?.status || 0));
}

async function structuredResponse({ requestedModel, instructions, input, schemaName, maxTokens, web }) {
  const models = await textCandidates(requestedModel);
  let lastError;
  for (const model of models) {
    try {
      const request = {
        model,
        reasoning: { effort: "low" },
        instructions,
        input,
        max_output_tokens: maxTokens,
        text: { format: { type: "json_schema", name: schemaName, strict: true, schema: ARTICLE_SCHEMA } }
      };
      if (web) {
        request.tools = [{ type: "web_search", search_context_size: "low" }];
        request.tool_choice = "auto";
      }
      const response = await client().responses.create(request, { timeout: TEXT_TIMEOUT, maxRetries: 0 });
      if (!response.output_text) throw new Error("글 생성 결과가 비어 있습니다.");
      return response.output_text;
    } catch (error) {
      lastError = error;
      if (protectedError(error)) throw error;
      console.error(`Text model ${model} failed:`, error.message);
    }
  }
  throw lastError || new Error("사용 가능한 글 작성 모델을 찾지 못했습니다.");
}

export async function generateArticle(options) {
  const imageCount = clamp(options.imageCount, 0, 4);
  const articleLength = clamp(options.articleLength, 1200, 12000);
  const currentDate = options.currentDate || koreaDate();
  const request = {
    requestedModel: options.textModel,
    instructions: `정확성과 실용성을 우선하는 한국어 편집자다. 오늘은 ${currentDate}다.`,
    input: articlePrompt(options, currentDate, imageCount, articleLength),
    schemaName: "blog_article",
    maxTokens: Math.max(4200, Math.min(8000, Math.ceil(articleLength * 1.5)))
  };

  let output;
  try {
    output = await structuredResponse({ ...request, web: true });
  } catch (error) {
    if (protectedError(error)) throw error;
    console.error("Web-assisted generation failed, retrying fast mode:", error.message);
    output = await structuredResponse({ ...request, web: false });
  }

  try {
    return normalizeArticle(JSON.parse(output), imageCount);
  } catch {
    throw new Error("AI가 반환한 글 데이터를 해석하지 못했습니다. 다시 생성해 주세요.");
  }
}

export async function polishArticle(article, options) {
  const currentDate = options.currentDate || koreaDate();
  try {
    const output = await structuredResponse({
      requestedModel: options.textModel,
      instructions: `한국어 블로그 편집장이다. 오늘은 ${currentDate}다.`,
      input: `아래 글의 반복, 어색한 문장, 구조를 개선하되 이미지 마커와 출처 배열을 보존하라. 최신 사실을 임의로 만들지 마라.\n${JSON.stringify(article)}`,
      schemaName: "reviewed_blog_article",
      maxTokens: 7000,
      web: false
    });
    return normalizeArticle(JSON.parse(output), Math.max(0, (article.image_prompts || []).length - 1));
  } catch (error) {
    console.error("Premium review skipped:", error.message);
    return cleanArticleOutput(article);
  }
}

function xml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

async function fallbackThumbnail(item) {
  const title = String(item.alt || "블로그 핵심 가이드").replace(/대표 썸네일/g, "").trim().slice(0, 36);
  const caption = String(item.caption || "핵심 내용을 한눈에 확인하세요").slice(0, 55);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><linearGradient id="g"><stop stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="1024" height="1024" rx="42" fill="#f8fafc"/><rect x="72" y="72" width="210" height="56" rx="28" fill="url(#g)"/><text x="177" y="109" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="white">핵심 정보</text><foreignObject x="72" y="190" width="880" height="330"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;font-size:65px;font-weight:800;line-height:1.25;color:#111827;word-break:keep-all">${xml(title)}</div></foreignObject><line x1="72" x2="952" y1="570" y2="570" stroke="#dbe1ea" stroke-width="3"/><text x="72" y="635" font-family="Arial,sans-serif" font-size="27" fill="#475569">${xml(caption)}</text><g transform="translate(72 715)"><rect width="270" height="155" rx="24" fill="#eef2ff"/><rect x="293" width="270" height="155" rx="24" fill="#f3e8ff"/><rect x="586" width="270" height="155" rx="24" fill="#eff6ff"/><text x="35" y="95" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#334155">확인</text><text x="328" y="95" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#334155">비교</text><text x="621" y="95" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#334155">실행</text></g><text x="72" y="948" font-family="Arial,sans-serif" font-size="23" fill="#64748b">정확한 정보 · 쉬운 설명 · 바로 쓰는 체크리스트</text></svg>`;
  const filename = await saveGeneratedImage(Buffer.from(svg, "utf8"), "svg");
  return { index: 1, kind: "main-thumbnail", filename, localUrl: `/generated/${filename}`, alt: `${title} 대표 썸네일`, caption: item.caption, prompt: item.prompt, fallback: true };
}

async function imageModels() {
  const configured = String(process.env.OPENAI_IMAGE_MODEL || "gpt-image-2").trim();
  const available = (await modelIds()).filter((id) => /^(?:gpt-image|chatgpt-image)/i.test(id));
  return available.length ? [...new Set([configured, ...available].filter((id) => available.includes(id)))] : [configured];
}

async function imageBuffer(result) {
  const data = result.data?.[0];
  if (data?.b64_json) return Buffer.from(data.b64_json, "base64");
  if (data?.url) {
    const response = await fetch(data.url, { signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error("이미지 다운로드에 실패했습니다.");
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error("이미지 생성 결과가 비어 있습니다.");
}

export async function generateImages(imagePrompts) {
  const prompts = Array.isArray(imagePrompts) ? imagePrompts.slice(0, 5) : [];
  const models = await imageModels();
  const images = [];

  for (let index = 0; index < prompts.length; index += 1) {
    const item = prompts[index];
    const thumbnail = index === 0;
    const prompt = thumbnail
      ? `${item.prompt}\n1:1 square Korean blog main thumbnail, readable Korean title, blue-violet and white palette, no watermark.`
      : `${item.prompt}\nLandscape 16:9 editorial photograph, no text, no logo, no watermark.`;
    let generated = null;
    for (const model of models) {
      try {
        const result = await client().images.generate({
          model,
          prompt,
          size: thumbnail ? "1024x1024" : "1536x1024",
          quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
          output_format: "webp",
          output_compression: 82,
          n: 1
        }, { timeout: IMAGE_TIMEOUT, maxRetries: 0 });
        const filename = await saveGeneratedImage(await imageBuffer(result), "webp");
        generated = { index: index + 1, kind: thumbnail ? "main-thumbnail" : "body-image", filename, localUrl: `/generated/${filename}`, alt: thumbnail ? `${String(item.alt || "").replace(/대표 썸네일/g, "").trim()} 대표 썸네일`.trim() : item.alt, caption: item.caption, prompt: item.prompt };
        break;
      } catch (error) {
        console.error(`Image model ${model} failed:`, error.message);
        if (protectedError(error)) break;
      }
    }
    if (generated) images.push(generated);
    else if (thumbnail) images.push(await fallbackThumbnail(item));
  }

  return images;
}
