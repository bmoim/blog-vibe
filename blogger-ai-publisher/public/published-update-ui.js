const actions = document.querySelector(".panel-actions.wrap");
const draftSelect = document.querySelector("#growthDraftSelect");
const toastElement = document.querySelector("#growthToast");

function toast(message, duration = 6000) {
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastElement.classList.add("hidden"), duration);
}

function showLoading(active, title, message) {
  const overlay = document.querySelector("#growthLoading");
  if (!overlay) return;
  document.querySelector("#growthLoadingTitle").textContent = title || "공개 글을 업데이트하고 있습니다";
  document.querySelector("#growthLoadingMessage").textContent = message || "Blogger에 수정 내용을 반영하고 있습니다.";
  overlay.classList.toggle("hidden", !active);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

async function refreshButton(button) {
  const draftId = draftSelect?.value;
  if (!draftId) {
    button.disabled = true;
    button.textContent = "공개 글 업데이트";
    button.title = "먼저 초안을 선택하세요.";
    return;
  }
  try {
    const data = await request(`/api/growth/drafts/${encodeURIComponent(draftId)}/published-status`);
    button.disabled = !data.published;
    button.textContent = data.published ? "기존 공개 글 덮어쓰기" : "공개 발행 기록 없음";
    button.title = data.published
      ? "이 초안에서 마지막으로 공개 발행한 Blogger 글에 현재 내용을 반영합니다."
      : "먼저 메인 화면에서 이 초안을 Blogger에 공개 발행하세요.";
  } catch {
    button.disabled = true;
    button.textContent = "공개 글 확인 실패";
  }
}

if (actions && draftSelect) {
  const button = document.createElement("button");
  button.className = "button danger";
  button.type = "button";
  button.disabled = true;
  button.textContent = "공개 글 업데이트";
  actions.appendChild(button);

  draftSelect.addEventListener("change", () => refreshButton(button));
  button.addEventListener("click", async () => {
    const draftId = draftSelect.value;
    if (!draftId) return;
    if (!confirm("현재 초안 내용으로 기존 Blogger 공개 글을 덮어쓸까요? 기존 초안 버전은 자동 백업됩니다.")) return;
    showLoading(true, "기존 공개 글을 업데이트하고 있습니다", "이미지와 본문을 다시 전송하고 있습니다.");
    try {
      const data = await request(`/api/growth/drafts/${encodeURIComponent(draftId)}/update-published`, { method: "POST", body: "{}" });
      toast("기존 Blogger 공개 글을 최신 초안으로 업데이트했습니다.");
      if (data.result?.url && confirm("업데이트된 공개 글을 새 창에서 열까요?")) window.open(data.result.url, "_blank", "noopener");
    } catch (error) {
      toast(error.message, 10000);
    } finally {
      showLoading(false);
      refreshButton(button);
    }
  });

  refreshButton(button);
}
