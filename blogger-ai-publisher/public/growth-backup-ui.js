const topActions = document.querySelector(".growth-topbar .top-actions");
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
  document.querySelector("#growthLoadingTitle").textContent = title || "백업을 처리하고 있습니다";
  document.querySelector("#growthLoadingMessage").textContent = message || "잠시만 기다려 주세요.";
  overlay.classList.toggle("hidden", !active);
}

async function restoreBackup(file) {
  if (!file) return;
  if (!confirm("현재 저장된 초안과 설정을 백업 파일 내용으로 복원할까요? 기존 데이터는 백업 파일 기준으로 교체됩니다.")) return;
  showLoading(true, "백업을 복원하고 있습니다", "초안과 생성 이미지를 다시 저장하고 있습니다.");
  try {
    const response = await fetch("/api/growth/backup/import", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "백업 복원에 실패했습니다.");
    toast(`복원이 완료되었습니다. 이미지 ${data.restoredImageCount || 0}개를 복원했습니다.`);
    setTimeout(() => location.reload(), 900);
  } catch (error) {
    toast(error.message, 10000);
  } finally {
    showLoading(false);
  }
}

if (topActions) {
  const topics = document.createElement("a");
  topics.className = "button primary";
  topics.href = "/topics.html";
  topics.textContent = "주제 발굴실";

  const download = document.createElement("a");
  download.className = "button secondary";
  download.href = "/api/growth/backup/export";
  download.textContent = "전체 백업 다운로드";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.hidden = true;
  input.addEventListener("change", () => restoreBackup(input.files?.[0]));

  const restore = document.createElement("button");
  restore.className = "button secondary";
  restore.type = "button";
  restore.textContent = "백업 복원";
  restore.addEventListener("click", () => input.click());

  topActions.prepend(topics);
  topActions.append(download, restore, input);
}

import("/site-health-ui.js?v=20260711-11").catch((error) => console.error("사이트 상태 UI를 불러오지 못했습니다.", error));
import("/connection-wizard-ui.js?v=20260711-11").catch((error) => console.error("Google 자동 연결 UI를 불러오지 못했습니다.", error));
import("/google-persistence.js?v=20260712-1").catch((error) => console.error("Google 자동 연결 유지 모듈을 불러오지 못했습니다.", error));
import("/citation-cleanup-ui.js?v=20260712-3").catch((error) => console.error("출처 문구 정리 UI를 불러오지 못했습니다.", error));
