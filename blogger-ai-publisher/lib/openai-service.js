import OpenAI from "openai";
import { saveGeneratedImage } from "./storage.js";
import { cleanArticleOutput } from "./article-cleanup.js";

const ARTICLE_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "meta_description", "slug", "excerpt", "labels", "body_html", "faq", "image_prompts", "sources", "risk_notice"],
  properties: {
    title: { type: "string" }, meta_description: { type: "string" }, slug: { type: "string" }, excerpt: { type: "string" }, body_html: { type: "string" }, risk_notice: { type: "string" },
    labels: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
    faq: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false, required: ["question", "answer"], properties: { question: { type: "string" }, answer: { type: "string" } } } },
    image_prompts: { type: "array", minItems: 1, maxItems: 5, items: { type: "object", additionalProperties: false, required: ["prompt", "alt", "caption"], properties: { prompt: { type: "string" }, alt: { type: "string" }, caption: { type: "string" } } } },
    sources: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["title", "url"], properties: { title: { type: "string" }, url: { type: "string" } } } }
  }
};

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 540000),
    maxRetries: 2
  });
}

function configuredTextModel() {
  const configured = String(process.env.OPENAI_TEXT_MODEL || "gpt-5.6").trim();
  return configured === "gpt-5.6-terra" ? "gpt-5.6" : configured;
}

function textModel(requested) {
  const candidate = String(requested || configuredTextModel()).trim();
  const blocked = /(audio|realtime|transcribe|tts|image|search|codex|embedding|moderation)/i;
  if (/^gpt-5(?:[.\w-]*)?$/i.test(candidate) && !blocked.test(candidate)) return candidate;
  return configuredTextModel();
}

export async function listAvailableTextModels() {
  const fallback = configuredTextModel();
  try {
    const page = await getClient().models.list();
    const ids = (page.data || [])
      .map((model) => String(model.id || ""))
      .filter((id) => /^gpt-5(?:[.\w-]*)?$/i.test(id))
      .filter((id) => !/(audio|realtime|transcribe|tts|image|search|codex|embedding|moderation)/i.test(id))
      .filter((id) => !/-\d{4}-\d{2}-\d{2}$/.test(id));
    const unique = [...new Set([fallback, ...ids])];
    return unique.sort((a, b) => {
      if (a === fallback) return -1;
      if (b === fallback) return 1;
      return b.localeCompare(a, "en", { numeric: true });
    });
  } catch {
    return [fallback];
  }
}

function koreaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function clamp(value, min, max) { const number = Number(value); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min; }

function defaultThumbnailPrompt(article) {
  const labels = Array.isArray(article.labels) ? article.labels.slice(0, 4).join(", ") : "핵심 정보, 비교, 가이드, 체크포인트";
  return {
    prompt: `Create a premium Korean blog main thumbnail as a 1:1 square infographic. Bright white or very light gray background, deep royal blue to violet accents, very large bold Korean headline on the left, rounded blue badge at top-left, realistic topic-related hero visual at upper-right, thin divider, three rounded information cards across the lower middle, and a bottom strip with four small blue outline icons. Exact main headline: "${article.title}". Supporting line: "${article.meta_description}". Use these short content themes for cards and highlights: ${labels}. Clean commercial Korean blog thumbnail, strong hierarchy, soft shadows, no brand logo, no watermark, no random English, no invented numbers or claims. Korean text must be readable and correctly spelled.`,
    alt: `${article.title} 대표 썸네일`,
    caption: article.meta_description || article.excerpt || "블로그 대표 썸네일"
  };
}

function normalizeArticle(rawArticle, bodyImageCount) {
  const article = cleanArticleOutput(rawArticle);
  const desiredTotal = clamp(bodyImageCount, 0, 4) + 1;
  const prompts = Array.isArray(article.image_prompts) ? article.image_prompts.slice(0, desiredTotal) : [];
  if (!prompts.length) prompts.push(defaultThumbnailPrompt(article));
  prompts[0] = {
    ...prompts[0],
    alt: String(prompts[0]?.alt || `${article.title} 대표 썸네일`).includes("대표 썸네일") ? String(prompts[0]?.alt || `${article.title} 대표 썸네일`) : `${article.title} 대표 썸네일`,
    caption: String(prompts[0]?.caption || article.meta_description || article.excerpt || "블로그 대표 썸네일")
  };

  const normalized = {
    ...article,
    title: String(article.title || "").trim(), meta_description: String(article.meta_description || "").trim(), slug: String(article.slug || "").trim(), excerpt: String(article.excerpt || "").trim(), body_html: String(article.body_html || "").trim(),
    labels: [...new Set((article.labels || []).map((label) => String(label).trim()).filter(Boolean))].slice(0, 8), faq: Array.isArray(article.faq) ? article.faq.slice(0, 6) : [],
    sources: Array.isArray(article.sources) ? article.sources.filter((source) => /^https?:\/\//i.test(source?.url || "")).slice(0, 12) : [],
    image_prompts: prompts,
    risk_notice: String(article.risk_notice || "").trim()
  };

  if (!normalized.body_html.includes("{{IMAGE_1}}")) normalized.body_html = `<p>{{IMAGE_1}}</p>\n${normalized.body_html}`;
  for (let i = 1; i < normalized.image_prompts.length; i += 1) {
    const marker = `{{IMAGE_${i + 1}}}`;
    if (!normalized.body_html.includes(marker)) {
      const sections = [...normalized.body_html.matchAll(/<\/h2>/gi)];
      const section = sections[i - 1];
      if (section) { const insertAt = section.index + section[0].length; normalized.body_html = `${normalized.body_html.slice(0, insertAt)}\n<p>${marker}</p>\n${normalized.body_html.slice(insertAt)}`; }
      else normalized.body_html += `\n<p>${marker}</p>`;
    }
  }
  return normalized;
}

function freshnessRules(currentDate) {
  return `\n[현재 시점과 최신성 규칙]\n- 오늘 날짜는 대한민국 시간 기준 ${currentDate}이다.\n- "현재", "오늘", "올해", "최근", "최신"은 반드시 ${currentDate}를 기준으로 해석한다.\n- 가격, 지원금, 신청 기간, 법령, 제도, 제품 사양, 인물·직책, 의료·금융 정보처럼 바뀔 수 있는 사실은 웹 검색으로 지금 유효한지 확인한다.\n- 오래된 자료를 현재 정보처럼 쓰지 않는다. 2025년 등 과거 날짜는 역사적 비교가 필요할 때만 그 날짜를 명확히 밝힌다.\n- 가능하면 공식 기관·제조사·정부·원문 자료를 우선하고, 자료의 게시일 또는 갱신일도 확인한다.\n- 최신 정보가 확인되지 않으면 임의로 채우지 말고 확인 방법과 불확실성을 명시한다.\n- 제목이나 본문에 "2025년 기준"처럼 오래된 기준일을 현재 기준으로 잘못 제시하지 않는다.`;
}

function articlePrompt({ topic, targetKeyword, audience, tone, language, articleLength, imageCount, customInstructions, currentDate }) {
  return `당신은 검색 사용자의 문제를 실제로 해결하는 전문 편집자다. 아래 조건으로 Blogger에 바로 넣을 수 있는 고품질 글을 작성하라.\n\n[입력]\n- 주제: ${topic}\n- 핵심 키워드: ${targetKeyword || topic}\n- 독자: ${audience || "일반 독자"}\n- 문체: ${tone || "신뢰감 있고 쉽게 설명하는 문체"}\n- 언어: ${language || "한국어"}\n- 목표 분량: 약 ${articleLength}자\n- 본문 이미지 수: ${imageCount}개\n- 별도 대표 썸네일: 1:1 정사각형 1장 필수\n- 추가 지시: ${customInstructions || "없음"}\n${freshnessRules(currentDate)}\n\n[품질 원칙]\n1. 검색 의도를 첫 문단에서 바로 해결하고 반복을 피한다.\n2. 경험·비교·체크리스트·실행 단계처럼 바로 활용할 고유한 가치를 넣는다.\n3. 제목은 과장 없이 구체적으로 작성하고 핵심 키워드를 자연스럽게 포함한다.\n4. body_html은 완성된 HTML 조각이다. h1은 쓰지 말고 h2, h3, p, ul, ol, table, blockquote, strong, a를 사용한다.\n5. image_prompts의 첫 번째 항목은 반드시 1:1 대표 썸네일용 프롬프트다. 나머지 항목만 본문 이미지다. 전체 image_prompts 수는 ${imageCount + 1}개다.\n6. 대표 썸네일 프롬프트는 다음 고정 디자인을 구체적으로 포함한다: 화이트 또는 연한 그레이 배경, 진한 블루~보라 포인트, 왼쪽의 매우 큰 한국어 제목, 왼쪽 상단 둥근 배지, 오른쪽 상단의 주제 대표 실사 비주얼, 제목 아래 얇은 구분선, 하단의 라운드 카드 3개, 맨 아래 아이콘형 요약 4개. 고급스럽고 깔끔한 한국 블로그 인포그래픽 디자인, 1:1 정사각형.\n7. 대표 썸네일 프롬프트에는 최종 제목을 정확한 한국어 메인 헤드라인으로 넣고, 본문에서 검증된 핵심 내용만 카드 문구로 사용한다. 가격·날짜·수치가 확인되지 않았다면 임의로 넣지 않는다. alt에는 반드시 '대표 썸네일'이라는 단어를 포함한다.\n8. body_html의 가장 첫 부분에 대표 썸네일 위치인 {{IMAGE_1}}을 정확히 한 번 넣는다. 본문 이미지 마커는 {{IMAGE_2}}부터 순서대로 각각 한 번 넣는다.\n9. 본문 이미지 프롬프트에는 글자, 로고, 워터마크를 넣지 말고 16:9 블로그 이미지 구도와 조명을 구체적으로 쓴다.\n10. sources에는 이번 검색에서 실제 확인한 신뢰도 높은 URL만 넣는다. 본문 문장 끝에 마크다운 링크, 괄호형 링크, 출처 도메인, utm_source=openai 같은 추적 주소를 절대 넣지 않는다. 출처는 sources 배열에만 기록한다.\n11. 건강·법률·세무·보험·투자 주제는 단정하지 말고 risk_notice에 주의 문구를 쓴다.\n12. 존재하지 않는 통계, 기관, 법령, 사양, 인용문을 만들지 않는다.\n13. 상투적 자동생성 문구, 키워드 반복, 애드센스 클릭 유도를 금지한다.\n14. FAQ는 실제 후속 질문 중심으로 쓴다.\n15. 메타 설명은 약 80~155자, 제목은 가능하면 28~60자다.\n\n반드시 지정된 JSON 스키마만 반환하라.`;
}

export async function generateArticle(options) {
  const client = getClient();
  const imageCount = clamp(options.imageCount, 0, 4);
  const articleLength = clamp(options.articleLength, 1200, 12000);
  const currentDate = options.currentDate || koreaDate();
  const request = {
    model: textModel(options.textModel),
    reasoning: { effort: "low" },
    instructions: `정확성, 최신성, 유용성, 독창성, 사람의 최종 검수를 우선하는 편집 시스템이다. 오늘은 대한민국 시간 기준 ${currentDate}다.`,
    input: articlePrompt({ ...options, imageCount, articleLength, currentDate }),
    max_output_tokens: 12000,
    text: { format: { type: "json_schema", name: "blog_article", strict: true, schema: ARTICLE_SCHEMA } },
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required"
  };
  const response = await client.responses.create(request);
  if (!response.output_text) throw new Error("글 생성 결과가 비어 있습니다.");
  try { return normalizeArticle(JSON.parse(response.output_text), imageCount); }
  catch { throw new Error("AI가 반환한 글 데이터를 해석하지 못했습니다. 다시 생성해 주세요."); }
}

export async function polishArticle(article, options) {
  const currentDate = options.currentDate || koreaDate();
  const reviewMode = options.premiumReview
    ? "최신성 검증과 함께 중복, 문장 품질, 구조, 검색 의도까지 엄격하게 개선한다."
    : "문장 구조는 가능한 유지하되 최신성·사실 정확성만 반드시 검증하고 수정한다.";
  const response = await getClient().responses.create({
    model: textModel(options.textModel),
    reasoning: { effort: "low" },
    instructions: `실제 독자에게 도움이 되는 글만 통과시키는 최신성 검증 편집장이다. 오늘은 대한민국 시간 기준 ${currentDate}다.`,
    input: `다음 글 JSON을 웹 검색으로 다시 검증하고 개선하라. ${reviewMode}\n불확실하거나 현재와 맞지 않는 내용은 삭제·수정하고, 최신 공식 출처 URL로 sources를 갱신하며 이미지 마커를 보존하라. 본문에는 마크다운 링크, 괄호형 출처 링크, 도메인 표기, utm_source=openai 추적 주소를 넣지 말고 출처는 sources 배열에만 기록하라. image_prompts 첫 항목의 1:1 대표 썸네일 디자인 지시와 {{IMAGE_1}} 위치도 반드시 보존하라.${freshnessRules(currentDate)}\n목표 언어는 ${options.language || "한국어"}다.\n\n${JSON.stringify(article)}`,
    max_output_tokens: 12000,
    text: { format: { type: "json_schema", name: "fresh_blog_article", strict: true, schema: ARTICLE_SCHEMA } },
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required"
  });
  if (!response.output_text) return cleanArticleOutput(article);
  try { return normalizeArticle(JSON.parse(response.output_text), Math.max(0, article.image_prompts.length - 1)); }
  catch { return cleanArticleOutput(article); }
}

export async function generateImages(imagePrompts) {
  const client = getClient(); const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  return Promise.all(imagePrompts.map(async (item, index) => {
    const isThumbnail = index === 0;
    const prompt = isThumbnail
      ? `${item.prompt}\nSquare 1:1 premium Korean blog main thumbnail, crisp commercial infographic layout, readable Korean headline, blue-violet and white palette, realistic topic visual, three lower information cards, four-icon bottom strip, no watermark, no logo.`
      : `${item.prompt}\nProfessional editorial blog photography, landscape 16:9 composition, no text, no logo, no watermark, culturally natural and visually credible.`;
    const result = await client.images.generate({ model, prompt, size: isThumbnail ? "1024x1024" : "1536x1024", quality: process.env.OPENAI_IMAGE_QUALITY || "medium", output_format: "webp", output_compression: 82, n: 1 });
    const b64 = result.data?.[0]?.b64_json; if (!b64) throw new Error(`${index + 1}번째 이미지 생성 결과가 비어 있습니다.`);
    const filename = await saveGeneratedImage(Buffer.from(b64, "base64"), "webp");
    return { index: index + 1, kind: isThumbnail ? "main-thumbnail" : "body-image", filename, localUrl: `/generated/${filename}`, alt: isThumbnail ? `${String(item.alt || "대표 썸네일").replace(/대표 썸네일/g, "").trim()} 대표 썸네일`.trim() : item.alt, caption: item.caption, prompt: item.prompt };
  }));
}
