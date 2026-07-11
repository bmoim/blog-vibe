const actions = document.querySelector(".growth-topbar .top-actions");
const toastElement = document.querySelector("#growthToast");
const loadingElement = document.querySelector("#growthLoading");

function toast(message, duration = 7000) {
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastElement.classList.add("hidden"), duration);
}

function loading(active) {
  if (!loadingElement) return;
  document.querySelector("#growthLoadingTitle").textContent = "출처 문구를 정리하고 있습니다";
  document.querySelector("#growthLoadingMessage").textContent = "기존 초안을 백업한 뒤 불필요한 괄호형 링크와 추적 주소를 제거합니다.";
  loadingElement.classList.toggle("hidden", !active);
}

if (actions) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button secondary";
  button.textContent = "기존 출처문구 정리";
  button.addEventListener("click", async () => {
    if (!confirm("저장된 모든 초안에서 괄호형 출처 링크와 utm_source=openai 추적 문구를 제거할까요? 변경 전 버전은 자동 백업됩니다.")) return;
    loading(true);
    try {
      const response = await fetch("/api/growth/cleanup-citations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "출처 문구 정리에 실패했습니다.");
      toast(`정리가 완료되었습니다. 수정 ${data.updated}개 · 변경 없음 ${data.skipped}개`);
    } catch (error) {
      toast(error.message, 10000);
    } finally {
      loading(false);
    }
  });
  actions.appendChild(button);
}
