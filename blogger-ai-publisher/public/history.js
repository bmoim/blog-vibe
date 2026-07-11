const $ = (selector) => document.querySelector(selector);

function esc(value) {
  return String(value || "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
}

function toast(message, duration = 7000) {
  const element = $("#historyToast");
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), duration);
}

function loading(active) {
  $("#historyLoading").classList.toggle("hidden", !active);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

function metric(label, value) {
  return `<div class="history-metric"><span>${esc(label)}</span><strong>${Number(value || 0).toLocaleString("ko-KR")}</strong></div>`;
}

function renderStatus(status) {
  const badge = $("#persistenceBadge");
  badge.className = `badge ${status.databaseConnected ? "success" : "neutral"}`;
  badge.textContent = status.databaseConnected ? "PostgreSQL 영구 저장" : "브라우저 자동 백업";
  $("#persistenceMetrics").innerHTML = [
    metric("저장된 초안", status.counts?.drafts),
    metric("주제 계획", status.counts?.topicPlans),
    metric("조회·작업 기록", status.counts?.activities),
    metric("버전 백업", status.counts?.versions),
    metric("전체 데이터 기록", status.totalRecords)
  ].join("");
  $("#persistenceMessage").textContent = status.databaseConnected
    ? `데이터베이스와 자동 동기화 중입니다.${status.lastSyncedAt ? ` 마지막 저장: ${new Date(status.lastSyncedAt).toLocaleString("ko-KR")}` : ""}`
    : "현재는 이 브라우저에 자동 백업합니다. Render PostgreSQL의 DATABASE_URL을 연결하면 다른 기기와 재배포 후에도 서버에서 영구 보관됩니다.";
}

function renderHistory(records) {
  $("#historyList").innerHTML = records.length ? records.map((item) => {
    const meta = Object.entries(item.metadata || {})
      .filter(([key, value]) => value !== "" && value != null && !["method", "path"].includes(key))
      .slice(0, 8)
      .map(([key, value]) => `<span class="history-chip">${esc(key)}: ${esc(typeof value === "object" ? JSON.stringify(value) : value)}</span>`)
      .join("");
    return `<article class="history-item"><div class="history-item-head"><div><h3>${esc(item.title)}</h3>${item.query ? `<p>${esc(item.query)}</p>` : ""}</div><time>${new Date(item.createdAt).toLocaleString("ko-KR")}</time></div><div class="history-meta"><span class="history-chip">${esc(item.type)}</span><span class="history-chip ${esc(item.status)}">${esc(item.status)}</span>${meta}</div></article>`;
  }).join("") : '<p class="muted">아직 저장된 조회·작업 기록이 없습니다.</p>';
}

async function loadHistory() {
  const search = encodeURIComponent($("#historySearch").value.trim());
  const type = encodeURIComponent($("#historyType").value);
  const data = await api(`/api/growth/history?limit=500&search=${search}&type=${type}`);
  renderStatus(data.status);
  renderHistory(data.records || []);
}

async function syncNow() {
  loading(true);
  try {
    const data = await api("/api/growth/persistence/sync", { method: "POST", body: "{}" });
    renderStatus(data.status);
    toast(data.status.databaseConnected ? "최신 데이터를 PostgreSQL에 영구 저장했습니다." : "최신 데이터를 이 브라우저의 자동 백업 대상으로 저장했습니다.");
  } catch (error) {
    toast(error.message, 10000);
  } finally {
    loading(false);
  }
}

let searchTimer;
$("#historySearch").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadHistory().catch((error) => toast(error.message)), 350); });
$("#historyType").addEventListener("change", () => loadHistory().catch((error) => toast(error.message)));
$("#refreshHistory").addEventListener("click", () => loadHistory().catch((error) => toast(error.message)));
$("#syncPersistenceNow").addEventListener("click", syncNow);

loadHistory().catch((error) => toast(error.message, 10000));
