import OpenAI from "openai";
import { saveGeneratedImage } from "./storage.js";

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 540000),
    maxRetries: 2
  });
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHeadings(html) {
  return [...String(html || "").matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)]
    .map((match) => stripHtml(match[1]))
    .filter(Boolean)
    .slice(0, 3);
}

function makeCardItems(article) {
  const headings = extractHeadings(article.body_html);
  const labels = Array.isArray(article.labels) ? article.labels.map((item) => String(item).trim()).filter(Boolean) : [];
  const candidates = [...headings, ...labels];
  const unique = [...new Set(candidates)].slice(0, 3);
  const fallbacks = ["핵심 기준", "비교 포인트", "꼭 확인할 내용"];
  return Array.from({ length: 3 }, (_, index) => ({
    title: unique[index] || fallbacks[index],
    detail: index === 0 ? "한눈에 확인" : index === 1 ? "쉽게 비교" : "실전 체크"
  }));
}

function makeHighlights(article) {
  const labels = Array.isArray(article.labels) ? article.labels.map((item) => String(item).trim()).filter(Boolean) : [];
  const fallbacks = ["최신 정보", "핵심 비교", "실전 팁", "체크포인트"];
  return Array.from({ length: 4 }, (_, index) => labels[index] || fallbacks[index]);
}

function createPrompt(article, options = {}) {
  const title = String(article.title || options.topic || "핵심 정보 정리").trim();
  const meta = String(article.meta_description || article.excerpt || "중요한 내용을 보기 쉽게 정리했습니다.").trim();
  const cards = makeCardItems(article);
  const highlights = makeHighlights(article);
  const dateBadge = options.currentDate ? `${options.currentDate.slice(0, 4)} 최신 정보` : "핵심 정보 한눈에";

  return `Create a premium Korean blog main thumbnail as a square 1:1 infographic, closely following this visual system:

DESIGN SYSTEM
- 1024x1024 square canvas
- bright white or very light cool-gray background
- deep royal blue to violet accent colors
- clean commercial Korean blog thumbnail design
- large bold Korean headline on the left, broken into 2 or 3 balanced lines
- rounded blue badge at the top-left
- realistic topic-related hero visual in the upper-right with soft light and subtle depth
- thin divider below the headline
- three rounded white information cards across the lower middle, each with a circular blue icon, a short title, and one concise detail line
- bottom white summary strip with four small blue outline icons and four short benefit phrases
- generous spacing, strong hierarchy, premium editorial layout, crisp edges, soft shadows
- visually similar to a polished Korean service-price or guide infographic thumbnail
- no brand logo, no watermark, no random English, no clutter
- keep all text inside safe margins

EXACT KOREAN TEXT TO USE
Top badge: "${dateBadge}"
Main headline: "${title}"
Supporting line: "${meta.slice(0, 70)}"
Card 1 title: "${cards[0].title}" / detail: "${cards[0].detail}"
Card 2 title: "${cards[1].title}" / detail: "${cards[1].detail}"
Card 3 title: "${cards[2].title}" / detail: "${cards[2].detail}"
Bottom highlight 1: "${highlights[0]}"
Bottom highlight 2: "${highlights[1]}"
Bottom highlight 3: "${highlights[2]}"
Bottom highlight 4: "${highlights[3]}"

HERO VISUAL
Use a realistic, high-quality visual that directly represents this topic: "${options.topic || title}".

IMPORTANT
- Korean text must be readable, correctly spelled, and high contrast.
- Prioritize the headline and the 3-card layout.
- Do not invent prices, dates, percentages, or claims that were not provided above.
- If any supporting text is too long, shorten its visual presentation while preserving the meaning.
- The final image must look like a professional blog main thumbnail, not a generic poster.`;
}

export async function generateThumbnail(article, options = {}) {
  const client = getClient();
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const prompt = createPrompt(article, options);
  const result = await client.images.generate({
    model,
    prompt,
    size: "1024x1024",
    quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
    output_format: "webp",
    output_compression: 82,
    n: 1
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("대표 썸네일 생성 결과가 비어 있습니다.");
  const filename = await saveGeneratedImage(Buffer.from(b64, "base64"), "webp");
  return {
    kind: "main-thumbnail",
    filename,
    localUrl: `/generated/${filename}`,
    alt: `${article.title} 대표 썸네일`,
    caption: article.meta_description || article.excerpt || "블로그 대표 썸네일",
    prompt
  };
}
