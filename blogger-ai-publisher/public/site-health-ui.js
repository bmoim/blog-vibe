const toolbar = document.querySelector(".growth-toolbar");
const draftSelect = document.querySelector("#growthDraftSelect");
const resultTarget = document.querySelector("#contentIntelligenceResult");
const loadingOverlay = document.querySelector("#growthLoading");
const toastElement = document.querySelector("#growthToast");

function esc(value) {
  return String(value || "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
}

function toast(message, duration = 6500) {
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastElement.classList.add("hidden"), duration);
}

function loading(active, title, message) {
  if (!loadingOverlay) return;
  document.querySelector("#growthLoadingTitle").textContent = title || "사이트 상태를 확인하고 있습니다";
  document.querySelector("#growthLoadingMessage").textContent = message || "잠시만 기다려 주세요.";
  loadingOverlay.classList.toggle("hidden", !active);
}

async function request(url) {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

function selectedDraft() {
  const id = draftSelect?.value;
  if (!id) toast("분석할 초안을 먼저 선택해 주세요.");
  return id;
}

function indexHtml(data) {
  const index = data.indexStatus || {};
  const mobile = data.mobileUsability || {};
  const rich = data.richResults || {};
  const verdict = index.verdict || "UNKNOWN";
  const coverage = index.coverageState || index.indexingState || "확인 정보 없음";
  return `
    <h3>Google 색인 상태</h3>
    <div class="quality-score">
      <div class="quality-number">${esc(verdict === "PASS" ? "✓" : verdict === "FAIL" ? "!" : "?")}</div>
      <div><strong>${esc(coverage)}</strong><p class="muted">${esc(data.url)}</p></div>
    </div>
    <div class="check-list">
      <div class="check-row ${verdict === "PASS" ? "pass" : "fail"}"><strong>색인 판정: ${esc(verdict)}</strong><p>${esc(index.lastCrawlTime ? `마지막 크롤링 ${new Date(index.lastCrawlTime).toLocaleString("ko-KR")}` : "크롤링 기록을 확인하세요.")}</p></div>
      <div class="check-row ${mobile.verdict === "PASS" ? "pass" : "fail"}"><strong>모바일 사용성: ${esc(mobile.verdict || "UNKNOWN")}</strong><p>${esc((mobile.issues || []).map((item) => item.issueType).join(", ") || "확인된 문제 없음")}</p></div>
      <div class="check-row ${rich.verdict === "PASS" ? "pass" : "fail"}"><strong>리치 결과: ${esc(rich.verdict || "UNKNOWN")}</strong><p>${esc((rich.detectedItems || []).map((item) => item.richResultType).join(", ") || "감지된 구조화 데이터 없음")}</p></div>
    </div>
    ${data.inspectionResultLink ? `<div class="action-row"><a class="button secondary" href="${esc(data.inspectionResultLink)}" target="_blank" rel="noopener">Search Console에서 자세히 보기</a></div>` : ""}
  `;
}

function linksHtml(data) {
  return `
    <h3>출처·내부링크 상태</h3>
    <p class="muted">총 ${data.total}개 확인 · 정상 ${data.ok}개 · 문제 ${data.broken?.length || 0}개</p>
    <div class="check-list">
      ${(data.results || []).length ? data.results.map((item) => `<div class="check-row ${item.ok ? "pass" : "fail"}"><strong>${item.ok ? "✓" : "!"} ${esc(item.url)}</strong><p>${item.ok ? `HTTP ${item.status} · ${item.durationMs}ms` : esc(item.error || `HTTP ${item.status}`)}${item.finalUrl && item.finalUrl !== item.url ? ` · 최종 주소 ${esc(item.finalUrl)}` : ""}</p></div>`).join("") : '<p class="empty-state">확인할 외부 링크가 없습니다.</p>'}
    </div>
  `;
}

if (toolbar && draftSelect && resultTarget) {
  const indexButton = document.createElement("button");
  indexButton.id = "runIndexInspection";
  indexButton.className = "button secondary";
  indexButton.type = "button";
  indexButton.textContent = "Google 색인 상태";

  const linkButton = document.createElement("button");
  linkButton.id = "runLinkHealth";
  linkButton.className = "button secondary";
  linkButton.type = "button";
  linkButton.textContent = "깨진 링크 점검";

  toolbar.append(indexButton, linkButton);

  indexButton.addEventListener("click", async () => {
    const id = selectedDraft(); if (!id) return;
    loading(true, "Google 색인 상태를 확인하고 있습니다", "Search Console URL 검사 결과를 불러오고 있습니다.");
    try {
      resultTarget.innerHTML = indexHtml(await request(`/api/growth/drafts/${encodeURIComponent(id)}/index-inspection`));
    } catch (error) {
      toast(error.message, 10000);
    } finally { loading(false); }
  });

  linkButton.addEventListener("click", async () => {
    const id = selectedDraft(); if (!id) return;
    loading(true, "출처와 내부링크를 점검하고 있습니다", "최대 30개 링크를 안전하게 확인합니다.");
    try {
      resultTarget.innerHTML = linksHtml(await request(`/api/growth/drafts/${encodeURIComponent(id)}/link-health`));
    } catch (error) {
      toast(error.message, 10000);
    } finally { loading(false); }
  });
}
