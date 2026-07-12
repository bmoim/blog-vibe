const GOOGLE_SESSION_KEY = "blogger-ai-publisher:google-session-v1";
const RESTORE_ATTEMPT_KEY = "blogger-ai-publisher:google-restore-attempt";

function persistenceToast(message, duration = 6000) {
  const element = document.querySelector("#toast") || document.querySelector("#growthToast");
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(persistenceToast.timer);
  persistenceToast.timer = setTimeout(() => element.classList.add("hidden"), duration);
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

function blobFingerprint(blob) {
  let hash = 0;
  for (let index = 0; index < blob.length; index += Math.max(1, Math.floor(blob.length / 120))) {
    hash = ((hash << 5) - hash + blob.charCodeAt(index)) | 0;
  }
  return `${blob.length}:${Math.abs(hash)}`;
}

function addPersistenceBadge() {
  const badge = document.querySelector("#connectionBadge");
  if (!badge || document.querySelector("#googlePersistenceNote")) return;
  const note = document.createElement("span");
  note.id = "googlePersistenceNote";
  note.className = "badge neutral";
  note.style.fontSize = "11px";
  note.textContent = localStorage.getItem(GOOGLE_SESSION_KEY) ? "자동 연결 저장됨" : "자동 연결 준비 중";
  badge.insertAdjacentElement("afterend", note);
}

function updatePersistenceBadge(saved) {
  const note = document.querySelector("#googlePersistenceNote");
  if (!note) return;
  note.textContent = saved ? "자동 연결 저장됨" : "자동 연결 미저장";
  note.className = `badge ${saved ? "success" : "neutral"}`;
}

async function exportConnectedSession() {
  const data = await requestJson("/api/growth/google-session/export");
  if (!data.blob) throw new Error("Google 자동 연결 저장값을 받지 못했습니다.");
  localStorage.setItem(GOOGLE_SESSION_KEY, data.blob);
  sessionStorage.removeItem(RESTORE_ATTEMPT_KEY);
  updatePersistenceBadge(true);
  return data;
}

async function restoreSavedSession(blob) {
  const fingerprint = blobFingerprint(blob);
  if (sessionStorage.getItem(RESTORE_ATTEMPT_KEY) === fingerprint) return false;
  sessionStorage.setItem(RESTORE_ATTEMPT_KEY, fingerprint);
  await requestJson("/api/growth/google-session/restore", {
    method: "POST",
    body: JSON.stringify({ blob })
  });
  sessionStorage.removeItem(RESTORE_ATTEMPT_KEY);
  return true;
}

function installExplicitDisconnectHandler() {
  const button = document.querySelector("#googleButton");
  if (!button) return;
  button.addEventListener("click", () => {
    if (/해제/.test(button.textContent || "")) {
      localStorage.removeItem(GOOGLE_SESSION_KEY);
      sessionStorage.removeItem(RESTORE_ATTEMPT_KEY);
      updatePersistenceBadge(false);
    }
  }, true);
}

async function initializeGooglePersistence() {
  addPersistenceBadge();
  installExplicitDisconnectHandler();
  const params = new URLSearchParams(location.search);
  const justConnected = params.get("google") === "connected";

  try {
    const status = await requestJson("/api/status");
    if (status.googleConnected) {
      await exportConnectedSession();
      if (justConnected) persistenceToast("Google 연결을 이 브라우저에 안전하게 저장했습니다. 이제 접속할 때마다 다시 연결하지 않아도 됩니다.", 8000);
      return;
    }

    const blob = localStorage.getItem(GOOGLE_SESSION_KEY);
    if (!blob) {
      updatePersistenceBadge(false);
      return;
    }

    const restored = await restoreSavedSession(blob);
    if (restored) {
      persistenceToast("저장된 Google 연결을 자동으로 복원했습니다.", 5000);
      const url = new URL(location.href);
      url.searchParams.delete("google");
      url.searchParams.delete("message");
      url.searchParams.set("googleRestored", "1");
      location.replace(url.toString());
    }
  } catch (error) {
    const message = String(error.message || "");
    if (/복호화|호환되지|올바르지|토큰/.test(message)) {
      localStorage.removeItem(GOOGLE_SESSION_KEY);
      sessionStorage.removeItem(RESTORE_ATTEMPT_KEY);
      updatePersistenceBadge(false);
      persistenceToast("저장된 Google 연결이 만료되었거나 보안 키가 변경되었습니다. Google을 한 번만 다시 연결해 주세요.", 10000);
    }
  }
}

initializeGooglePersistence();
