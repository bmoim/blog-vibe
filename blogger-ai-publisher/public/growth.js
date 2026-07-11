const $ = (selector) => document.querySelector(selector);
const state = { settings: null, drafts: [], blogs: [], selectedDraftId: "" };

function esc(value) {
  return String(value || "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
}
function pct(value) { return `${(Number(value || 0) * 100).toFixed(1)}%`; }
function num(value) { return Number(value || 0).toLocaleString("ko-KR", { maximumFractionDigits: 2 }); }
function money(value, currency = "") { return `${currency ? `${currency} ` : ""}${num(value)}`; }
function selectedDraftId() { return $("#growthDraftSelect").value; }
function toast(message, duration = 5000) {
  const element = $("#growthToast");
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), duration);
}
function loading(active, title = "데이터를 처리하고 있습니다", message = "잠시만 기다려 주세요.") {
  $("#growthLoadingTitle").textContent = title;
  $("#growthLoadingMessage").textContent = message;
  $("#growthLoading").classList.toggle("hidden", !active);
}
async function api(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}
function requireDraft() {
  const id = selectedDraftId();
  if (!id) { toast("분석할 초안을 먼저 선택해 주세요."); return null; }
  return id;
}

async function loadSettings() {
  const data = await api("/api/growth/settings");
  state.settings = data.settings;
  $("#growthSiteUrl").value = data.settings.searchConsoleSite || "";
  $("#growthGa4Property").value = data.settings.ga4PropertyId || "";
  $("#growthAdsenseAccount").value = data.settings.adsenseAccount || "";
  $("#growthAuthorName").value = data.settings.author?.name || "";
  $("#growthAuthorRole").value = data.settings.author?.role || "";
  $("#growthAuthorUrl").value = data.settings.author?.profileUrl || "";
  $("#growthAuthorBio").value = data.settings.author?.bio || "";
  $("#growthDisclosure").value = data.settings.author?.disclosure || "";
}

async function saveSettings() {
  loading(true, "설정을 저장하고 있습니다");
  try {
    const payload = {
      searchConsoleSite: $("#growthSiteUrl").value,
      ga4PropertyId: $("#growthGa4Property").value,
      adsenseAccount: $("#growthAdsenseAccount").value,
      author: {
        name: $("#growthAuthorName").value,
        role: $("#growthAuthorRole").value,
        profileUrl: $("#growthAuthorUrl").value,
        bio: $("#growthAuthorBio").value,
        disclosure: $("#growthDisclosure").value
      }
    };
    state.settings = (await api("/api/growth/settings", { method: "PUT", body: JSON.stringify(payload) })).settings;
    $("#growthSetupMessage").textContent = "설정을 저장했습니다.";
    toast("성장 센터 설정을 저장했습니다.");
  } finally { loading(false); }
}

async function loadSites() {
  loading(true, "Search Console 속성을 불러오는 중입니다");
  try {
    const sites = (await api("/api/growth/sites")).sites || [];
    $("#growthSiteSelect").innerHTML = '<option value="">속성 선택</option>' + sites.map((site) => `<option value="${esc(site.siteUrl)}">${esc(site.siteUrl)} · ${esc(site.permissionLevel)}</option>`).join("");
    if (!sites.length) toast("Search Console 속성을 찾지 못했습니다. Google 권한과 속성 소유권을 확인하세요.");
  } catch (error) { toast(`${error.message} Google 권한을 다시 연결해 보세요.`, 9000); } finally { loading(false); }
}

function renderMetric(label, value, note = "") {
  return `<div class="metric-card"><span>${esc(label)}</span><strong>${esc(value)}</strong>${note ? `<small>${esc(note)}</small>` : ""}</div>`;
}
function renderPageList(items, type) {
  if (!items?.length) return '<p class="empty-state">해당 항목이 없습니다.</p>';
  return items.map((item) => {
    const detail = type === "decline"
      ? `클릭 ${num(item.clicks)} (${num(item.clickChange)}) · 순위 ${num(item.position)} (${num(item.positionChange)})`
      : `노출 ${num(item.impressions)} · 클릭 ${num(item.clicks)} · CTR ${pct(item.ctr)} · 순위 ${num(item.position)}`;
    return `<div class="result-item"><strong>${esc(item.page || item.query)}</strong><p>${esc(detail)}</p>${item.page ? `<a href="${esc(item.page)}" target="_blank" rel="noopener">페이지 열기</a>` : ""}</div>`;
  }).join("");
}
async function loadDashboard() {
  loading(true, "검색·방문·수익 데이터를 불러오는 중입니다", "Google API 설정에 따라 시간이 조금 걸릴 수 있습니다.");
  try {
    const data = await api("/api/growth/dashboard");
    const sc = data.searchConsole || {};
    const ga = data.ga4 || {};
    const ad = data.adsense || {};
    $("#growthMetrics").innerHTML = [
      renderMetric("검색 클릭", num(sc.totals?.clicks), sc.error || "최근 28일"),
      renderMetric("검색 노출", num(sc.totals?.impressions), sc.configured ? `CTR ${pct(sc.totals?.ctr)}` : sc.error || "미설정"),
      renderMetric("평균 검색 순위", num(sc.totals?.position), "낮을수록 좋음"),
      renderMetric("GA4 페이지뷰", num(ga.pageViews), ga.error || "최근 28일"),
      renderMetric("활성 사용자", num(ga.activeUsers), ga.configured ? `세션 ${num(ga.sessions)}` : ga.error || "미설정"),
      renderMetric("AdSense 예상 수익", money(ad.estimatedEarnings, ad.currencyCode), ad.configured ? `RPM ${num(ad.pageViewsRpm)}` : ad.error || "미설정")
    ].join("");
    $("#lowCtrResults").innerHTML = renderPageList(sc.lowCtr, "low");
    $("#nearWinResults").innerHTML = renderPageList(sc.nearWins, "near");
    $("#declineResults").innerHTML = renderPageList(sc.declines, "decline");
    if (sc.error || ga.error || ad.error) toast("일부 데이터는 API 미설정 또는 권한 부족으로 표시되지 않았습니다.", 7000);
  } catch (error) { toast(error.message, 9000); } finally { loading(false); }
}

async function loadDraftsAndBlogs() {
  const [draftData, blogData] = await Promise.all([api("/api/growth/drafts"), api("/api/blogs").catch(() => ({ blogs: [] }))]);
  state.drafts = draftData.drafts || [];
  state.blogs = blogData.blogs || [];
  const draftOptions = '<option value="">초안 선택</option>' + state.drafts.map((draft) => `<option value="${esc(draft.id)}">${esc(draft.title)} · SEO ${draft.seoScore}</option>`).join("");
  $("#growthDraftSelect").innerHTML = draftOptions;
  $("#scheduleDraftSelect").innerHTML = draftOptions;
  $("#scheduleBlogSelect").innerHTML = '<option value="">블로그 선택</option>' + state.blogs.map((blog) => `<option value="${esc(blog.id)}">${esc(blog.name)}</option>`).join("");
}

function qualityHtml(quality) {
  return `<div class="quality-score"><div class="quality-number">${quality.score}</div><div><h3>${quality.pass ? "공개 발행 가능" : "개선 후 발행 권장"}</h3><p class="muted">차단 항목 ${quality.blockers.length}개</p></div></div><div class="check-list">${quality.checks.map((check) => `<div class="check-row ${check.passed ? "pass" : "fail"}"><strong>${check.passed ? "✓" : "!"} ${esc(check.name)}</strong><p>${esc(check.detail || (check.passed ? "통과" : "개선 필요"))}</p></div>`).join("")}</div>`;
}
async function runQuality() {
  const id = requireDraft(); if (!id) return;
  loading(true, "발행 전 품질을 검사하고 있습니다");
  try { $("#contentIntelligenceResult").innerHTML = qualityHtml((await api(`/api/growth/drafts/${id}/quality`)).quality); } finally { loading(false); }
}
async function runCannibalization() {
  const id = requireDraft(); if (!id) return;
  loading(true, "유사한 글과 키워드 중복을 검사하고 있습니다");
  try {
    const data = await api(`/api/growth/drafts/${id}/cannibalization`);
    $("#contentIntelligenceResult").innerHTML = `<h3>카니벌리제이션 위험: ${esc(data.risk)}</h3><div class="check-list">${data.matches.length ? data.matches.map((item) => `<div class="check-row ${item.similarity >= .45 ? "fail" : "pass"}"><strong>${esc(item.title)}</strong><p>유사도 ${(item.similarity * 100).toFixed(1)}%${item.url ? ` · <a href="${esc(item.url)}" target="_blank">발행 글 열기</a>` : ""}</p></div>`).join("") : '<p class="empty-state">강하게 겹치는 초안이 없습니다.</p>'}</div>`;
  } finally { loading(false); }
}
async function runInternalLinks() {
  const id = requireDraft(); if (!id) return;
  loading(true, "관련 글을 찾고 있습니다");
  try {
    const suggestions = (await api(`/api/growth/drafts/${id}/internal-links`)).suggestions || [];
    $("#contentIntelligenceResult").innerHTML = `<h3>추천 내부링크</h3><div class="link-list">${suggestions.length ? suggestions.map((item, index) => `<label class="link-row"><input type="checkbox" class="internal-link-check" data-index="${index}" checked><span><strong>${esc(item.title)}</strong><small>${esc(item.url)} · 관련도 ${(item.score * 100).toFixed(1)}%</small></span><a class="button secondary" href="${esc(item.url)}" target="_blank">열기</a></label>`).join("") : '<p class="empty-state">발행 URL이 있는 관련 글을 찾지 못했습니다.</p>'}</div>${suggestions.length ? '<div class="action-row"><button id="applyInternalLinksNow" class="button primary">선택한 내부링크 적용</button></div>' : ""}`;
    $("#applyInternalLinksNow")?.addEventListener("click", async () => {
      const links = [...document.querySelectorAll(".internal-link-check:checked")].map((box) => suggestions[Number(box.dataset.index)]);
      loading(true, "내부링크를 본문에 삽입하고 있습니다");
      try { await api(`/api/growth/drafts/${id}/internal-links/apply`, { method: "POST", body: JSON.stringify({ links }) }); toast("내부링크를 적용하고 이전 버전을 백업했습니다."); await loadVersions(); } finally { loading(false); }
    });
  } finally { loading(false); }
}
async function runFreshness() {
  const id = requireDraft(); if (!id) return;
  loading(true, "현재 웹 정보와 기존 글을 비교하고 있습니다", "공식 출처를 확인하므로 시간이 걸릴 수 있습니다.");
  try {
    const audit = (await api(`/api/growth/drafts/${id}/freshness-audit`, { method: "POST", body: "{}" })).audit;
    $("#contentIntelligenceResult").innerHTML = `<h3>${esc(audit.summary)}</h3><p class="muted">검수일 ${esc(audit.checked_date)}</p><div class="issue-list">${audit.issues.length ? audit.issues.map((issue) => `<div class="issue-card"><strong>[${esc(issue.severity)}] ${esc(issue.type)}</strong><p><b>현재:</b> ${esc(issue.current_text)}</p><p><b>권장:</b> ${esc(issue.recommended_update)}</p>${issue.source_url ? `<a href="${esc(issue.source_url)}" target="_blank">확인한 출처</a>` : ""}</div>`).join("") : '<p class="empty-state">명확한 최신성 문제를 찾지 못했습니다.</p>'}</div>`;
  } finally { loading(false); }
}
async function runVariants() {
  const id = requireDraft(); if (!id) return;
  loading(true, "제목과 썸네일 개선안을 만들고 있습니다");
  try {
    const variants = (await api(`/api/growth/drafts/${id}/variants`, { method: "POST", body: "{}" })).variants;
    $("#contentIntelligenceResult").innerHTML = `<h3>제목 후보</h3><div class="variant-list">${variants.title_options.map((item, i) => `<div class="variant-card"><strong>${esc(item.type)} · ${esc(item.title)}</strong><p>${esc(item.reason)}</p><div class="action-row"><button class="button secondary apply-title-option" data-index="${i}">이 제목 적용</button></div></div>`).join("")}</div><h3>썸네일 후보</h3><div class="variant-list">${variants.thumbnail_options.map((item, i) => `<div class="variant-card"><strong>${esc(item.style)} · ${esc(item.headline)}</strong><p>${esc(item.prompt)}</p><div class="action-row"><button class="button secondary generate-thumbnail-option" data-index="${i}">이 디자인으로 생성</button></div></div>`).join("")}</div>`;
    document.querySelectorAll(".apply-title-option").forEach((button) => button.addEventListener("click", async () => {
      const item = variants.title_options[Number(button.dataset.index)];
      await api(`/api/growth/drafts/${id}/title`, { method: "POST", body: JSON.stringify({ title: item.title }) });
      toast("제목을 적용하고 이전 버전을 저장했습니다."); await loadDraftsAndBlogs(); await loadVersions();
    }));
    document.querySelectorAll(".generate-thumbnail-option").forEach((button) => button.addEventListener("click", async () => {
      const item = variants.thumbnail_options[Number(button.dataset.index)];
      loading(true, "선택한 디자인으로 1:1 썸네일을 생성하고 있습니다");
      try { await api(`/api/growth/drafts/${id}/thumbnail`, { method: "POST", body: JSON.stringify({ prompt: item.prompt }) }); toast("새 대표 썸네일을 생성하고 이전 버전을 저장했습니다."); await loadVersions(); } finally { loading(false); }
    }));
  } finally { loading(false); }
}

async function runMonitor() {
  loading(true, "업데이트가 필요한 글을 찾고 있습니다");
  try {
    const data = await api("/api/growth/monitor");
    $("#growthMonitorResults").innerHTML = data.candidates.length ? data.candidates.map((item) => `<div class="monitor-card"><span class="risk">${item.score}</span><h3>${esc(item.title)}</h3><p>마지막 수정 ${item.ageDays}일 전</p><p>${item.sensitive ? "변경 가능성이 높은 주제" : "일반 주제"}${item.oldYears.length ? ` · 과거 연도 ${item.oldYears.join(", ")}` : ""}</p><button class="button secondary monitor-select" data-id="${esc(item.draftId)}">선택하고 정밀 검수</button></div>`).join("") : '<p class="empty-state">우선 업데이트할 초안이 없습니다.</p>';
    document.querySelectorAll(".monitor-select").forEach((button) => button.addEventListener("click", () => { $("#growthDraftSelect").value = button.dataset.id; updateSelectedDraft(); runFreshness(); }));
  } finally { loading(false); }
}

async function applyAuthor() {
  const id = requireDraft(); if (!id) return;
  loading(true, "작성자 신뢰도 정보를 삽입하고 있습니다");
  try { await api(`/api/growth/drafts/${id}/author/apply`, { method: "POST", body: "{}" }); toast("작성자 정보와 검수일을 본문에 삽입했습니다."); await loadVersions(); } finally { loading(false); }
}
async function snapshotVersion() {
  const id = requireDraft(); if (!id) return;
  await api(`/api/growth/drafts/${id}/versions/snapshot`, { method: "POST", body: JSON.stringify({ reason: "manual-backup" }) });
  toast("현재 버전을 백업했습니다."); await loadVersions();
}
async function loadVersions() {
  const id = selectedDraftId();
  if (!id) { $("#draftVersions").innerHTML = '<p class="muted">초안을 선택하면 저장된 버전이 표시됩니다.</p>'; return; }
  const versions = (await api(`/api/growth/drafts/${id}/versions`)).versions || [];
  $("#draftVersions").innerHTML = versions.length ? versions.map((version) => `<div class="version-item"><div><strong>${esc(version.reason)}</strong><p>${new Date(version.createdAt).toLocaleString("ko-KR")} · SEO ${version.seoScore}</p></div><button class="button secondary restore-version" data-id="${esc(version.id)}">이 버전 복원</button></div>`).join("") : '<p class="empty-state">저장된 이전 버전이 없습니다.</p>';
  document.querySelectorAll(".restore-version").forEach((button) => button.addEventListener("click", async () => {
    if (!confirm("현재 상태를 백업한 뒤 이 버전으로 복원할까요?")) return;
    await api(`/api/growth/drafts/${id}/versions/${button.dataset.id}/restore`, { method: "POST", body: "{}" });
    toast("선택한 버전으로 복원했습니다."); await loadVersions();
  }));
}

async function loadSchedules() {
  const schedules = (await api("/api/growth/schedules")).schedules || [];
  const draftName = (id) => state.drafts.find((draft) => draft.id === id)?.title || id;
  const blogName = (id) => state.blogs.find((blog) => String(blog.id) === String(id))?.name || id;
  $("#growthSchedules").innerHTML = schedules.length ? schedules.map((item) => `<div class="schedule-item"><div><strong>${esc(draftName(item.draftId))}</strong><p>${esc(blogName(item.blogId))} · ${new Date(item.publishAt).toLocaleString("ko-KR")} · <span class="status-pill ${esc(item.status)}">${esc(item.status)}</span>${item.error ? ` · ${esc(item.error)}` : ""}</p></div>${["scheduled", "failed"].includes(item.status) ? `<button class="button secondary delete-schedule" data-id="${esc(item.id)}">삭제</button>` : ""}</div>`).join("") : '<p class="empty-state">예약된 글이 없습니다.</p>';
  document.querySelectorAll(".delete-schedule").forEach((button) => button.addEventListener("click", async () => { await api(`/api/growth/schedules/${button.dataset.id}`, { method: "DELETE" }); await loadSchedules(); toast("예약을 삭제했습니다."); }));
}
async function createScheduleItem() {
  const payload = { draftId: $("#scheduleDraftSelect").value, blogId: $("#scheduleBlogSelect").value, publishAt: $("#schedulePublishAt").value };
  loading(true, "예약 발행을 등록하고 있습니다");
  try { await api("/api/growth/schedules", { method: "POST", body: JSON.stringify(payload) }); toast("예약 발행을 등록했습니다."); await loadSchedules(); } finally { loading(false); }
}

function updateSelectedDraft() {
  state.selectedDraftId = selectedDraftId();
  const selected = state.drafts.find((draft) => draft.id === state.selectedDraftId);
  $("#selectedDraftStatus").textContent = selected ? selected.title : "초안 선택 필요";
  $("#selectedDraftStatus").className = `badge ${selected ? "success" : "neutral"}`;
  $("#scheduleDraftSelect").value = state.selectedDraftId || "";
  loadVersions().catch((error) => toast(error.message));
}

$("#saveGrowthSettings").addEventListener("click", () => saveSettings().catch((error) => toast(error.message, 9000)));
$("#loadGrowthSites").addEventListener("click", loadSites);
$("#growthSiteSelect").addEventListener("change", () => { if ($("#growthSiteSelect").value) $("#growthSiteUrl").value = $("#growthSiteSelect").value; });
$("#refreshGrowthDashboard").addEventListener("click", loadDashboard);
$("#growthReconnectGoogle").addEventListener("click", () => { location.href = "/auth/google"; });
$("#growthDraftSelect").addEventListener("change", updateSelectedDraft);
$("#runQualityGate").addEventListener("click", runQuality);
$("#runCannibalization").addEventListener("click", runCannibalization);
$("#runInternalLinks").addEventListener("click", runInternalLinks);
$("#runFreshnessAudit").addEventListener("click", runFreshness);
$("#runVariants").addEventListener("click", runVariants);
$("#runGrowthMonitor").addEventListener("click", runMonitor);
$("#applyAuthorBox").addEventListener("click", applyAuthor);
$("#createVersionSnapshot").addEventListener("click", snapshotVersion);
$("#refreshVersions").addEventListener("click", loadVersions);
$("#openDraftInEditor").addEventListener("click", () => { const id = requireDraft(); if (id) location.href = `/?generatedDraft=${encodeURIComponent(id)}`; });
$("#createGrowthSchedule").addEventListener("click", createScheduleItem);
$("#runDueSchedules").addEventListener("click", async () => { loading(true, "예약 발행을 확인하고 있습니다"); try { await api("/api/growth/schedules/run", { method: "POST", body: "{}" }); await loadSchedules(); } finally { loading(false); } });

(async function init() {
  try {
    await Promise.all([loadSettings(), loadDraftsAndBlogs()]);
    await Promise.all([loadSchedules(), runMonitor()]);
  } catch (error) { toast(error.message, 10000); }
})();
