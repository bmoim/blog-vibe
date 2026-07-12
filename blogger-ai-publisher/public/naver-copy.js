const $n = (selector) => document.querySelector(selector);

function naverAbsoluteUrl(value) {
  try { return new URL(value, window.location.origin).href; } catch { return value || ""; }
}

function naverEscape(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function naverToast(message) {
  const toast = $n("#toast");
  if (!toast) return alert(message);
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(naverToast.timer);
  naverToast.timer = setTimeout(() => toast.classList.add("hidden"), 4300);
}

function naverTitle() {
  return ($n("#editTitle")?.value || $n("#articlePreview h1")?.textContent || "").trim();
}

function naverTags() {
  const raw = [$n("#targetKeyword")?.value, ...($n("#editLabels")?.value || "").split(",")].filter(Boolean);
  const tags = [];
  for (const value of raw) {
    const tag = String(value).replace(/\s+/g, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 30);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= 10) break;
  }
  return tags.map((tag) => `#${tag}`).join(" ");
}

function createNaverBody() {
  const original = $n("#articlePreview");
  if (!original) return { html: "", text: "" };
  const source = original.cloneNode(true);
  source.querySelector("h1")?.remove();
  source.querySelector(".meta-description")?.remove();
  source.querySelectorAll("script,style,iframe").forEach((element) => element.remove());
  source.querySelectorAll("section,div").forEach((element) => {
    element.removeAttribute("class");
    element.removeAttribute("style");
  });
  source.querySelectorAll("h2").forEach((heading) => {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = `<strong>${heading.innerHTML}</strong>`;
    paragraph.setAttribute("style", "font-size:22px;line-height:1.55;margin:38px 0 14px;color:#111827;");
    heading.replaceWith(paragraph);
  });
  source.querySelectorAll("h3,h4").forEach((heading) => {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = `<strong>${heading.innerHTML}</strong>`;
    paragraph.setAttribute("style", "font-size:18px;line-height:1.6;margin:28px 0 10px;color:#1f2937;");
    heading.replaceWith(paragraph);
  });
  source.querySelectorAll("p").forEach((paragraph) => {
    if (!paragraph.getAttribute("style")) paragraph.setAttribute("style", "font-size:16px;line-height:1.95;margin:0 0 18px;color:#202124;");
  });
  source.querySelectorAll("ul,ol").forEach((list) => list.setAttribute("style", "font-size:16px;line-height:1.9;margin:12px 0 22px;padding-left:26px;color:#202124;"));
  source.querySelectorAll("li").forEach((item) => item.setAttribute("style", "margin:6px 0;"));
  source.querySelectorAll("table").forEach((table) => table.setAttribute("style", "width:100%;border-collapse:collapse;margin:20px 0;font-size:15px;"));
  source.querySelectorAll("th").forEach((cell) => cell.setAttribute("style", "border:1px solid #d1d5db;background:#f3f4f6;padding:10px;text-align:left;"));
  source.querySelectorAll("td").forEach((cell) => cell.setAttribute("style", "border:1px solid #d1d5db;padding:10px;text-align:left;"));
  source.querySelectorAll("blockquote").forEach((quote) => quote.setAttribute("style", "margin:24px 0;padding:16px 18px;border-left:4px solid #03c75a;background:#f5fff8;line-height:1.8;color:#374151;"));
  source.querySelectorAll("figure").forEach((figure) => figure.setAttribute("style", "margin:28px 0;text-align:center;"));
  source.querySelectorAll("figcaption").forEach((caption) => caption.setAttribute("style", "margin-top:8px;font-size:13px;line-height:1.6;color:#6b7280;text-align:center;"));
  source.querySelectorAll("img").forEach((image) => {
    image.src = naverAbsoluteUrl(image.getAttribute("src"));
    image.setAttribute("style", "display:block;max-width:100%;height:auto;margin:0 auto;border-radius:10px;");
    image.removeAttribute("loading");
  });
  source.querySelectorAll("a").forEach((link) => {
    link.href = naverAbsoluteUrl(link.getAttribute("href"));
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  const html = `<div style="max-width:760px;margin:0 auto;font-family:Arial,'Noto Sans KR',sans-serif;word-break:keep-all;overflow-wrap:break-word;">${source.innerHTML}</div>`;
  const textHolder = document.createElement("div");
  textHolder.innerHTML = html;
  const text = (textHolder.innerText || textHolder.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  return { html, text };
}

function renderNaverCopy() {
  const preview = $n("#naverPreview");
  const imageList = $n("#naverImageList");
  if (!preview || !imageList) return;
  const body = createNaverBody();
  preview.innerHTML = body.html || '<p class="muted">글을 생성하면 네이버용 본문이 표시됩니다.</p>';
  const images = [...($n("#articlePreview")?.querySelectorAll("img") || [])];
  imageList.innerHTML = images.length ? images.map((image, index) => {
    const url = naverAbsoluteUrl(image.getAttribute("src"));
    const alt = image.getAttribute("alt") || `본문 이미지 ${index + 1}`;
    return `<div class="naver-image-card"><img src="${naverEscape(url)}" alt="${naverEscape(alt)}"><div><strong>본문 이미지 ${index + 1}</strong><p>${naverEscape(alt)}</p><a class="button secondary image-open-button" href="${naverEscape(url)}" target="_blank" rel="noopener">이미지 열기</a></div></div>`;
  }).join("") : '<p class="muted">생성된 이미지가 없습니다.</p>';
}

async function fallbackCopy(text, html) {
  if (html) {
    const holder = document.createElement("div");
    holder.contentEditable = "true";
    holder.style.position = "fixed";
    holder.style.left = "-9999px";
    holder.innerHTML = html;
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("copy");
    selection.removeAllRanges();
    holder.remove();
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyNaverContent(text, html = "") {
  if (!text && !html) throw new Error("복사할 내용이 없습니다.");
  if (navigator.clipboard?.write && window.ClipboardItem && html) {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" })
    })]);
    return;
  }
  if (navigator.clipboard?.writeText && !html) return navigator.clipboard.writeText(text);
  return fallbackCopy(text, html);
}

function initializeNaverCopy() {
  const article = $n("#articlePreview");
  if (!article || !$n("#copyNaverTitleButton")) return;
  new MutationObserver(renderNaverCopy).observe(article, { childList: true, subtree: true, attributes: true });
  $n("#editTitle")?.addEventListener("input", renderNaverCopy);
  $n("#editLabels")?.addEventListener("input", renderNaverCopy);
  $n("#copyNaverTitleButton").addEventListener("click", async () => {
    const title = naverTitle();
    if (!title) return naverToast("먼저 글을 생성해 주세요.");
    try { await copyNaverContent(title); naverToast("네이버 제목 칸에 붙여넣을 제목을 복사했습니다."); } catch (error) { naverToast(`복사 실패: ${error.message}`); }
  });
  $n("#copyNaverBodyButton").addEventListener("click", async () => {
    const body = createNaverBody();
    if (!body.text) return naverToast("먼저 글을 생성해 주세요.");
    try { await copyNaverContent(body.text, body.html); naverToast("서식이 포함된 네이버용 본문을 복사했습니다."); } catch (error) { naverToast(`복사 실패: ${error.message}`); }
  });
  $n("#copyNaverTagsButton").addEventListener("click", async () => {
    const tags = naverTags();
    if (!tags) return naverToast("복사할 해시태그가 없습니다.");
    try { await copyNaverContent(tags); naverToast("네이버용 해시태그를 복사했습니다."); } catch (error) { naverToast(`복사 실패: ${error.message}`); }
  });
  renderNaverCopy();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializeNaverCopy);
else initializeNaverCopy();
