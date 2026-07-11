const state = { status: null, currentDraft: null, blogs: [] };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
function showToast(message, duration = 4200) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), duration);
}
function setLoading(active, title = "콘텐츠를 만들고 있습니다", message = "조사 → 글 작성 → 편집 검수 → 이미지 생성 순서로 진행합니다.") {
  $("#loadingTitle").textContent = title;
  $("#loadingMessage").textContent = message;
  $("#loadingOverlay").classList.toggle("hidden", !active);
}
async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

function renderStatus() {
  const status = state.status;
  const googleSource = status.googleConfigSource === "uploaded" ? "앱 JSON 설정(우선)" : status.googleConfigSource === "environment" ? "Render 설정" : "OAuth JSON 등록 필요";
  const googleDetail = status.googleConnected ? `연결됨 · ${googleSource}` : status.googleConfigured ? `미연결 · ${googleSource}` : googleSource;
  const rows = [
    ["OpenAI API", status.openaiConfigured, status.textModel],
    ["Google OAuth", status.googleConfigured, googleDetail],
    ["Google 콜백 URL", true, status.googleRedirectUri],
    ["이미지 호스팅", status.imageHostConfigured, status.imageHostMode],
    ["이미지 모델", true, status.imageModel],
    ["오늘 생성량", status.dailyUsage < status.dailyLimit, `${status.dailyUsage} / ${status.dailyLimit}회`]
  ];
  $("#statusList").innerHTML = rows.map(([name, ok, detail]) => `<div class="status-row"><span>${escapeHtml(name)}<br><small class="muted">${escapeHtml(detail || "")}</small></span><span class="${ok ? "status-ok" : "status-bad"}">${ok ? "정상" : "설정 필요"}</span></div>`).join("");
  $("#connectionBadge").textContent = status.googleConnected ? "Google 연결됨" : status.googleConfigured ? "Google 미연결" : "Google 설정 필요";
  $("#connectionBadge").className = `badge ${status.googleConnected ? "success" : "warning"}`;
  $("#googleButton").textContent = status.googleConnected ? "Google 연결 해제" : "Google 연결";
}

async function loadStatus() {
  state.status = await api("/api/status");
  renderStatus();
  if (state.status.googleConnected) await loadBlogs();
}
async function loadBlogs() {
  try {
    const data = await api("/api/blogs");
    state.blogs = data.blogs;
    $("#blogSelect").innerHTML = '<option value="">블로그 선택</option>' + data.blogs.map((blog) => `<option value="${blog.id}">${escapeHtml(blog.name)} · 글 ${blog.postsTotal}개</option>`).join("");
  } catch (error) { showToast(error.message); }
}
async function loadDrafts() {
  const data = await api("/api/drafts");
  const list = $("#draftList");
  if (!data.drafts.length) { list.innerHTML = '<p class="muted">초안이 없습니다.</p>'; return; }
  list.innerHTML = data.drafts.map((draft) => `<div class="draft-item"><button class="draft-title" data-open-draft="${draft.id}">${escapeHtml(draft.title)}</button><div class="draft-meta"><span>SEO ${draft.seoScore} · 이미지 ${draft.imageCount}</span><button class="draft-delete" data-delete-draft="${draft.id}">삭제</button></div></div>`).join("");
}

function renderDraft(draft) {
  state.currentDraft = draft;
  $("#editorSection").classList.remove("hidden");
  $("#articlePreview").innerHTML = `<h1>${escapeHtml(draft.article.title)}</h1><p class="meta-description">${escapeHtml(draft.article.meta_description)}</p>${draft.previewHtml}`;
  $("#editTitle").value = draft.article.title;
  $("#editMeta").value = draft.article.meta_description;
  $("#editLabels").value = (draft.article.labels || []).join(", ");
  $("#editBody").value = draft.article.body_html;
  const score = Number(draft.seoScore || 0);
  const scoreElement = $("#seoScore");
  scoreElement.textContent = "";
  scoreElement.dataset.label = score;
  scoreElement.style.background = `conic-gradient(var(--primary) ${score * 3.6}deg,#e8e8ef 0deg)`;
  $("#seoChecks").innerHTML = (draft.seoChecks || []).map((check) => `<div class="seo-check ${check.passed ? "pass" : "fail"}"><span>${check.passed ? "✓" : "!"} ${escapeHtml(check.name)}</span><strong>+${check.points}</strong></div>`).join("");
  $("#publishResult").textContent = "";
  $("#editorSection").scrollIntoView({ behavior: "smooth", block: "start" });
}
async function openDraft(id) {
  setLoading(true, "초안을 불러오는 중입니다");
  try { renderDraft((await api(`/api/drafts/${id}`)).draft); } finally { setLoading(false); }
}
async function generate(event) {
  event.preventDefault();
  setLoading(true);
  try {
    const payload = {
      topic: $("#topic").value, targetKeyword: $("#targetKeyword").value, audience: $("#audience").value,
      tone: $("#tone").value, language: $("#language").value, articleLength: Number($("#articleLength").value),
      imageCount: Number($("#imageCount").value), customInstructions: $("#customInstructions").value,
      useWebResearch: $("#useWebResearch").checked, premiumReview: $("#premiumReview").checked
    };
    const data = await api("/api/generate", { method: "POST", body: JSON.stringify(payload) });
    renderDraft(data.draft);
    await loadDrafts();
    showToast("글과 이미지 생성이 완료되었습니다.");
  } catch (error) { showToast(error.message, 7000); } finally { setLoading(false); }
}
async function saveCurrentDraft() {
  if (!state.currentDraft) return;
  setLoading(true, "수정사항을 저장하는 중입니다");
  try {
    const data = await api(`/api/drafts/${state.currentDraft.id}`, { method: "PUT", body: JSON.stringify({
      title: $("#editTitle").value, meta_description: $("#editMeta").value,
      labels: $("#editLabels").value.split(",").map((value) => value.trim()).filter(Boolean), body_html: $("#editBody").value
    }) });
    renderDraft(data.draft);
    await loadDrafts();
    showToast("수정사항을 저장했습니다.");
  } catch (error) { showToast(error.message); } finally { setLoading(false); }
}
async function publish(isDraft) {
  if (!state.currentDraft) return;
  const blogId = $("#blogSelect").value;
  if (!blogId) return showToast("발행할 블로그를 선택해 주세요.");
  if (!isDraft && !confirm("현재 내용을 공개 발행할까요?")) return;
  setLoading(true, isDraft ? "Blogger 초안을 만드는 중입니다" : "Blogger에 공개 발행 중입니다");
  try {
    const data = await api("/api/publish", { method: "POST", body: JSON.stringify({ draftId: state.currentDraft.id, blogId, isDraft, publishWithoutImages: $("#publishWithoutImages").checked }) });
    state.currentDraft = data.draft;
    const label = isDraft ? "Blogger 초안 저장 완료" : "공개 발행 완료";
    $("#publishResult").innerHTML = data.result.url ? `${label} · <a href="${data.result.url}" target="_blank">글 열기</a>` : label;
    showToast(label);
    await loadDrafts();
  } catch (error) { showToast(error.message, 7000); } finally { setLoading(false); }
}

function openGoogleSetup() {
  $("#googleJsonFile").value = "";
  $("#googleJsonText").value = "";
  $("#googleSetupDialog").showModal();
}
async function saveGoogleConfig() {
  const file = $("#googleJsonFile").files?.[0];
  let oauthJson = $("#googleJsonText").value.trim();
  if (file) oauthJson = await file.text();
  if (!oauthJson) return showToast("Google OAuth JSON 파일을 선택해 주세요.");
  setLoading(true, "Google 연결 정보를 저장하는 중입니다", "새 JSON 설정을 기존 Render 값보다 우선 적용합니다.");
  try {
    await api("/api/google/config", { method: "POST", body: JSON.stringify({ oauthJson }) });
    $("#googleSetupDialog").close();
    await loadStatus();
    showToast("새 Google OAuth 설정을 저장했습니다. 로그인으로 이동합니다.");
    setTimeout(() => { location.href = "/auth/google"; }, 500);
  } catch (error) { showToast(error.message, 7000); } finally { setLoading(false); }
}

$$('.tab').forEach((button) => button.addEventListener('click', () => {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
  $$('.tab-content').forEach((content) => content.classList.remove('active'));
  $(`#${button.dataset.tab}Tab`).classList.add('active');
}));
$("#generateForm").addEventListener("submit", generate);
$("#refreshDrafts").addEventListener("click", loadDrafts);
$("#saveDraftButton").addEventListener("click", saveCurrentDraft);
$("#publishDraftButton").addEventListener("click", () => publish(true));
$("#publishLiveButton").addEventListener("click", () => publish(false));
$("#saveGoogleConfigButton").addEventListener("click", saveGoogleConfig);
$("#googleConfigButton").addEventListener("click", openGoogleSetup);
$("#googleButton").addEventListener("click", async () => {
  if (state.status?.googleConnected) {
    await api("/api/google/disconnect", { method: "POST", body: "{}" });
    await loadStatus();
    showToast("Google 연결을 해제했습니다.");
  } else if (!state.status?.googleConfigured) {
    openGoogleSetup();
  } else {
    location.href = "/auth/google";
  }
});
$("#draftList").addEventListener("click", async (event) => {
  const open = event.target.closest("[data-open-draft]");
  if (open) await openDraft(open.dataset.openDraft);
  const remove = event.target.closest("[data-delete-draft]");
  if (remove && confirm("이 초안을 삭제할까요?")) {
    await api(`/api/drafts/${remove.dataset.deleteDraft}`, { method: "DELETE" });
    await loadDrafts();
    showToast("초안을 삭제했습니다.");
  }
});

Promise.all([loadStatus(), loadDrafts()]).catch((error) => showToast(error.message, 7000));
const params = new URLSearchParams(location.search);
if (params.get("google") === "connected") {
  showToast("Google 계정 연결이 완료되었습니다.");
  history.replaceState({}, "", "/");
  setTimeout(loadStatus, 250);
} else if (params.get("google") === "error") {
  const message = params.get("message") || "Google 연결에 실패했습니다.";
  showToast(message, 9000);
  history.replaceState({}, "", "/");
  if (message.includes("client") || message.includes("비밀번호") || message.includes("JSON")) setTimeout(openGoogleSetup, 300);
}
