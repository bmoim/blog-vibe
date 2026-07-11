const VAULT_DB = "blogger-ai-data-vault";
const VAULT_STORE = "snapshots";
const VAULT_KEY = "latest";
const RESTORE_SESSION_KEY = "blogger-ai-vault-restored";
let backupTimer = null;
let saving = false;

function openVault() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VAULT_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VAULT_STORE)) db.createObjectStore(VAULT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readVault() {
  const db = await openVault();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(VAULT_STORE, "readonly");
    const request = transaction.objectStore(VAULT_STORE).get(VAULT_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function writeVault(value) {
  const db = await openVault();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(VAULT_STORE, "readwrite");
    transaction.objectStore(VAULT_STORE).put(value, VAULT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "데이터 저장 요청에 실패했습니다.");
  return data;
}

function addHistoryLink() {
  const actions = document.querySelector(".top-actions");
  if (!actions || actions.querySelector('[href="/history.html"]')) return;
  const link = document.createElement("a");
  link.className = "button secondary";
  link.href = "/history.html";
  link.textContent = "기록·데이터";
  actions.prepend(link);
}

function addVaultBadge() {
  const actions = document.querySelector(".top-actions");
  if (!actions || document.querySelector("#dataVaultBadge")) return;
  const badge = document.createElement("span");
  badge.id = "dataVaultBadge";
  badge.className = "badge neutral";
  badge.textContent = "데이터 확인 중";
  actions.appendChild(badge);
}

function updateBadge(status, saved = false) {
  const badge = document.querySelector("#dataVaultBadge");
  if (!badge) return;
  if (status?.databaseConnected) {
    badge.className = "badge success";
    badge.textContent = "DB 영구 저장됨";
  } else if (saved) {
    badge.className = "badge success";
    badge.textContent = "브라우저 자동 백업됨";
  } else {
    badge.className = "badge neutral";
    badge.textContent = "브라우저 백업 준비";
  }
}

function bundleRecordCount(bundle) {
  const files = bundle?.files || {};
  const names = ["drafts.json", "topic-plans.json", "activity-history.json", "draft-versions.json"];
  return names.reduce((sum, name) => sum + (Array.isArray(files[name]) ? files[name].length : 0), 0);
}

async function saveCurrentSnapshot() {
  if (saving || document.visibilityState === "hidden" && !navigator.onLine) return;
  saving = true;
  try {
    const data = await requestJson("/api/growth/persistence/export");
    await writeVault({
      bundle: data.bundle,
      savedAt: new Date().toISOString(),
      totalRecords: bundleRecordCount(data.bundle)
    });
    updateBadge(data.status, true);
  } catch (error) {
    console.warn("Browser data vault backup failed:", error.message);
  } finally {
    saving = false;
  }
}

function scheduleBackup(delay = 1800) {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(saveCurrentSnapshot, delay);
}

function installMutationBackup() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const options = args[1] || {};
      const url = typeof input === "string" ? input : input?.url || "";
      const method = String(options.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase();
      if (response.ok && method !== "GET" && !url.includes("/persistence/") && !url.includes("/history")) scheduleBackup(1200);
    } catch {}
    return response;
  };
}

async function restoreIfServerWasReset(status) {
  if (status.totalRecords > 0 || sessionStorage.getItem(RESTORE_SESSION_KEY)) return false;
  const vault = await readVault();
  if (!vault?.bundle || Number(vault.totalRecords || bundleRecordCount(vault.bundle)) <= 0) return false;
  sessionStorage.setItem(RESTORE_SESSION_KEY, "1");
  const response = await fetch("/api/growth/persistence/import", {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/octet-stream" },
    body: JSON.stringify({ bundle: vault.bundle })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "브라우저 백업 복원에 실패했습니다.");
  location.reload();
  return true;
}

async function initializeDataVault() {
  addHistoryLink();
  addVaultBadge();
  installMutationBackup();
  try {
    const status = await requestJson("/api/growth/persistence/status");
    if (await restoreIfServerWasReset(status)) return;
    updateBadge(status, false);
    scheduleBackup(2500);
    setInterval(saveCurrentSnapshot, 1000 * 60 * 2);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveCurrentSnapshot();
    });
  } catch (error) {
    console.warn("Data vault initialization failed:", error.message);
  }
}

initializeDataVault();
