const preview = document.querySelector("#articlePreview");
const target = document.querySelector("#thumbnailPreview");

function addGrowthCenterLink() {
  const actions = document.querySelector(".top-actions");
  if (!actions || actions.querySelector('[href="/growth.html"]')) return;
  const link = document.createElement("a");
  link.className = "button primary";
  link.href = "/growth.html";
  link.textContent = "성장 센터";
  actions.prepend(link);
}

async function openRequestedDraft() {
  const params = new URLSearchParams(location.search);
  const draftId = params.get("generatedDraft");
  if (!draftId) return;
  history.replaceState({}, "", "/");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const button = document.querySelector(`[data-open-draft="${CSS.escape(draftId)}"]`);
    if (button) {
      button.click();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

function absoluteUrl(value) {
  try { return new URL(value, window.location.origin).href; } catch { return value || ""; }
}

function renderThumbnailTab() {
  if (!preview || !target) return;
  const image = [...preview.querySelectorAll("img")].find((item) => /대표 썸네일/.test(item.getAttribute("alt") || ""));
  if (!image) {
    target.innerHTML = '<p class="muted">이 초안에는 대표 썸네일이 없습니다. 새 글을 생성하면 1:1 대표 썸네일이 자동으로 만들어집니다.</p>';
    return;
  }

  const figure = image.closest("figure");
  const caption = figure?.querySelector("figcaption")?.textContent?.trim() || "블로그 대표 썸네일";
  const src = absoluteUrl(image.getAttribute("src"));
  const alt = image.getAttribute("alt") || "대표 썸네일";
  target.innerHTML = `
    <div class="thumbnail-stage">
      <img src="${src}" alt="${alt}">
    </div>
    <div class="thumbnail-meta-card">
      <div>
        <strong>대표 썸네일 생성 완료</strong>
        <p>${caption}</p>
      </div>
      <a class="button secondary" href="${src}" target="_blank" rel="noopener">이미지 열기</a>
    </div>
    <p class="thumbnail-note">Blogger 발행 시 이 이미지가 본문 맨 위 첫 번째 이미지로 들어갑니다. 네이버 복사 탭에서도 첫 번째 이미지로 포함됩니다.</p>
  `;
}

addGrowthCenterLink();
openRequestedDraft();
if (preview && target) {
  new MutationObserver(renderThumbnailTab).observe(preview, { childList: true, subtree: true, attributes: true });
  renderThumbnailTab();
}
