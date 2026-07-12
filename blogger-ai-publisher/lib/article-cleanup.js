function stripTrackingParameters(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const removable = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid", "ref", "ref_src"];
    for (const key of removable) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function cleanInlineCitationArtifacts(html) {
  let value = String(html || "");

  value = value.replace(/\s*\.\s*\(\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)\s*/g, ". ");
  value = value.replace(/\s*\(\[([^\]]+)\]\((https?:\/\/[^)]+)\)\)\s*/g, " ");
  value = value.replace(/\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*/g, " ");

  value = value.replace(/<p>\s*\.\s*<\/p>/gi, "");
  value = value.replace(/<p>\s*\(\s*<a\b[^>]*>[^<]*<\/a>\s*\)\s*<\/p>/gi, "");
  value = value.replace(/\s*\.\s*\(\s*<a\b[^>]*>[^<]*<\/a>\s*\)\s*/gi, ". ");
  value = value.replace(/\s*\(\s*<a\b[^>]*>[^<]*<\/a>\s*\)\s*/gi, " ");

  value = value.replace(/href=(['"])(https?:\/\/[^'"]+)\1/gi, (match, quote, url) => {
    return `href=${quote}${stripTrackingParameters(url)}${quote}`;
  });

  value = value.replace(/\?utm_source=openai(?:&amp;|&|$)[^'"\s<]*/gi, "");
  value = value.replace(/([.!?])\s+([.!?])/g, "$1");
  value = value.replace(/>\s{2,}</g, "> <");
  value = value.replace(/\s{2,}/g, " ");
  return value.trim();
}

function cleanSource(source) {
  const title = String(source?.title || "").replace(/^\s*[.·•-]+\s*/, "").trim();
  const url = stripTrackingParameters(String(source?.url || "").trim());
  return { title, url };
}

export function cleanArticleOutput(article) {
  const cleanedSources = [];
  const seen = new Set();
  for (const source of Array.isArray(article?.sources) ? article.sources : []) {
    const cleaned = cleanSource(source);
    if (!/^https?:\/\//i.test(cleaned.url) || seen.has(cleaned.url)) continue;
    seen.add(cleaned.url);
    cleanedSources.push(cleaned);
  }

  return {
    ...article,
    body_html: cleanInlineCitationArtifacts(article?.body_html),
    meta_description: String(article?.meta_description || "").replace(/\s*\(\[[^\]]+\]\(https?:\/\/[^)]+\)\)\s*/g, " ").trim(),
    excerpt: String(article?.excerpt || "").replace(/\s*\(\[[^\]]+\]\(https?:\/\/[^)]+\)\)\s*/g, " ").trim(),
    sources: cleanedSources
  };
}
