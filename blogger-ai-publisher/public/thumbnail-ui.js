const preview = document.querySelector("#articlePreview");
const target = document.querySelector("#thumbnailPreview");
const CURRENT_DRAFT_KEY = "blogger-ai-current-draft-id";
let publishQualityBypass = false;

function toast(message, duration = 6500) {
  const element = document.querySelector("#toast");
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), duration);
}

function addGrowthCenterLink() {
  const actions = document.querySelector(".top-actions");
  if (!actions || actions.querySelector('[href="/growth.html"]')) return;
  const link = document.createElement("a");
  link.className = "button primary";
  link.href = "/growth.html";
  link.textContent = "성장 센터";
  actions.prepend(link);
}

function trackOpenedDrafts() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-open-draft]");
    if (button?.dataset.openDraft) localStorage.setItem(CURRENT_DRAFT_KEY, button.dataset.openDraft);
  }, true);
}

async function openRequestedDraft() {
  const params = new URLSearchParams(location.search);
  const draftId = params.get("generatedDraft");
  if (!draftId) return;
  localStorage.setItem(CURRENT_DRAFT_KEY, draftId);
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

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

function installPublishQualityGuard() {
  const button = document.querySelector("#publishLiveButton");
  if (!button) return;
  button.addEventListener("click", async (event) => {
    if (publishQualityBypass) {
      publishQualityBypass = false;
      return;
    }
    const draftId = localStorage.getItem(CURRENT_DRAFT_KEY);
    if (!draftId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "발행 전 품질 검사 중…";
    try {
      const { quality } = await requestJson(`/api/growth/drafts/${encodeURIComponent(draftId)}/quality`);
      const failed = quality.checks?.filter((check) => !check.passed) || [];
      if (!quality.pass) {
        const summary = failed.slice(0, 5).map((check) => `• ${check.name}`).join("\n");
        const override = confirm(`품질 점수 ${quality.score}점입니다.\n\n개선 필요 항목:\n${summary || "추가 검수 필요"}\n\n그래도 공개 발행할까요?`);
        if (!override) {
          toast("공개 발행을 멈췄습니다. 성장 센터에서 개선한 뒤 다시 발행하세요.", 8000);
          return;
        }
      }
      await requestJson(`/api/growth/drafts/${encodeURIComponent(draftId)}/versions/snapshot`, {
        method: "POST",
        body: JSON.stringify({ reason: "before-live-publish" })
      }).catch(() => null);
      publishQualityBypass = true;
      button.click();
    } catch (error) {
      const proceed = confirm(`품질 검사를 완료하지 못했습니다.\n${error.message}\n\n그래도 공개 발행할까요?`);
      if (proceed) {
        publishQualityBypass = true;
        button.click();
      }
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }, true);
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
trackOpenedDrafts();
openRequestedDraft();
installPublishQualityGuard();
if (preview && target) {
  new MutationObserver(renderThumbnailTab).observe(preview, { childList: true, subtree: true, attributes: true });
  renderThumbnailTab();
}
