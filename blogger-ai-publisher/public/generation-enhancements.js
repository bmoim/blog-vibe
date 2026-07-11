const ACTIVE_JOB_KEY = "blogger-ai-active-generation-job";
const PENDING_DRAFT_KEY = "blogger-ai-pending-draft";
const SELECTED_MODEL_KEY = "blogger-ai-selected-text-model";
let pollingJobId = null;
let minimized = false;

const $ = (selector) => document.querySelector(selector);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    cache: "no-store",
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

function toast(message, duration = 6000) {
  const element = $("#toast");
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), duration);
}

function ensureProgressUi() {
  const card = $("#loadingOverlay .loader-card");
  if (!card || $("#generationProgress")) return;
  const progress = document.createElement("div");
  progress.id = "generationProgress";
  progress.className = "generation-progress";
  progress.innerHTML = '<div id="generationProgressBar" class="generation-progress-bar"></div>';
  const meta = document.createElement("div");
  meta.className = "generation-meta";
  meta.innerHTML = '<span id="generationProgressText">0%</span><span id="generationElapsed">0초</span>';
  const note = document.createElement("p");
  note.className = "generation-note";
  note.textContent = "모바일에서 다른 화면으로 이동해도 서버에서 생성은 계속됩니다. 다시 돌아오면 진행 상태를 이어서 확인합니다.";
  const button = document.createElement("button");
  button.id = "loadingMinimizeButton";
  button.type = "button";
  button.className = "button secondary";
  button.textContent = "화면에서 숨기기";
  button.addEventListener("click", () => {
    minimized = true;
    $("#loadingOverlay")?.classList.add("hidden");
    showBackgroundBanner();
  });
  card.append(progress, meta, note, button);
}

function ensureBackgroundBanner() {
  if ($("#backgroundJobBanner")) return;
  const banner = document.createElement("div");
  banner.id = "backgroundJobBanner";
  banner.className = "background-job-banner hidden";
  banner.innerHTML = '<span id="backgroundJobText">콘텐츠를 생성하고 있습니다.</span><button id="restoreJobOverlay" type="button">진행 보기</button>';
  document.body.appendChild(banner);
  $("#restoreJobOverlay").addEventListener("click", () => {
    minimized = false;
    banner.classList.add("hidden");
    $("#loadingOverlay")?.classList.remove("hidden");
  });
}

function showBackgroundBanner(message = "콘텐츠를 생성하고 있습니다.") {
  ensureBackgroundBanner();
  $("#backgroundJobText").textContent = message;
  $("#backgroundJobBanner").classList.remove("hidden");
}

function hideGenerationUi() {
  $("#loadingOverlay")?.classList.add("hidden");
  $("#backgroundJobBanner")?.classList.add("hidden");
  minimized = false;
}

function updateGenerationUi(job, startedAt) {
  ensureProgressUi();
  ensureBackgroundBanner();
  const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  $("#loadingTitle").textContent = job.status === "queued" ? "생성 작업을 준비하고 있습니다" : "콘텐츠를 만들고 있습니다";
  $("#loadingMessage").textContent = job.message || "최신 자료를 확인하고 있습니다.";
  $("#generationProgressBar").style.width = `${progress}%`;
  $("#generationProgressText").textContent = `${progress}%`;
  $("#generationElapsed").textContent = minutes ? `${minutes}분 ${seconds}초` : `${seconds}초`;
  if (minimized) showBackgroundBanner(`${progress}% · ${job.message || "생성 중"}`);
  else $("#loadingOverlay")?.classList.remove("hidden");
}

async function loadModelOptions() {
  const select = $("#textModel");
  if (!select) return;
  try {
    const data = await requestJson("/api/models");
    const models = Array.isArray(data.models) && data.models.length ? data.models : [data.defaultModel || "gpt-5.6"];
    const saved = localStorage.getItem(SELECTED_MODEL_KEY);
    select.innerHTML = models.map((model) => `<option value="${model}">${model}${model === data.defaultModel ? " · 기본" : ""}</option>`).join("");
    const chosen = saved && models.includes(saved) ? saved : (models.includes(data.defaultModel) ? data.defaultModel : models[0]);
    select.value = chosen;
    select.addEventListener("change", () => localStorage.setItem(SELECTED_MODEL_KEY, select.value));
  } catch {
    select.innerHTML = '<option value="gpt-5.6">gpt-5.6 · 기본</option>';
  }
}

async function updateFreshnessLabel() {
  try {
    const status = await requestJson("/api/status");
    const label = $("#freshnessDateLabel");
    if (label) label.textContent = `${status.currentDate || "오늘"} 기준 웹 검색·최신성 재검수`;
  } catch {}
}

function generationPayload() {
  return {
    topic: $("#topic")?.value || "",
    targetKeyword: $("#targetKeyword")?.value || "",
    audience: $("#audience")?.value || "",
    tone: $("#tone")?.value || "",
    language: $("#language")?.value || "한국어",
    articleLength: Number($("#articleLength")?.value || 2800),
    imageCount: Number($("#imageCount")?.value || 0),
    customInstructions: $("#customInstructions")?.value || "",
    useWebResearch: true,
    premiumReview: Boolean($("#premiumReview")?.checked),
    textModel: $("#textModel")?.value || "gpt-5.6"
  };
}

async function pollGenerationJob(jobId, startedAt = Date.now()) {
  if (!jobId || pollingJobId === jobId) return;
  pollingJobId = jobId;
  let networkFailures = 0;
  const deadline = Date.now() + 1000 * 60 * 35;
  try {
    while (Date.now() < deadline) {
      try {
        const data = await requestJson(`/api/generation-jobs/${encodeURIComponent(jobId)}?t=${Date.now()}`);
        networkFailures = 0;
        const job = data.job;
        updateGenerationUi(job, startedAt);
        if (job.status === "completed") {
          localStorage.removeItem(ACTIVE_JOB_KEY);
          localStorage.setItem(PENDING_DRAFT_KEY, job.draftId);
          hideGenerationUi();
          toast("글과 이미지 생성이 완료되었습니다. 초안을 불러옵니다.");
          await sleep(500);
          location.href = `/?generatedDraft=${encodeURIComponent(job.draftId)}&t=${Date.now()}`;
          return;
        }
        if (job.status === "failed") throw new Error(job.error || job.message || "생성에 실패했습니다.");
        await sleep(document.hidden ? 5000 : 2200);
      } catch (error) {
        networkFailures += 1;
        if (/찾을 수 없습니다|재시작/.test(error.message) || networkFailures >= 12) throw error;
        const retryMessage = `네트워크 연결을 다시 확인하고 있습니다. 자동 재시도 ${networkFailures}/12`;
        updateGenerationUi({ status: "running", progress: 0, message: retryMessage }, startedAt);
        await sleep(Math.min(12000, 2000 + networkFailures * 1000));
      }
    }
    throw new Error("생성 시간이 35분을 초과했습니다. Render 로그와 OpenAI 사용량을 확인해 주세요.");
  } catch (error) {
    localStorage.removeItem(ACTIVE_JOB_KEY);
    hideGenerationUi();
    toast(error.message, 12000);
  } finally {
    pollingJobId = null;
  }
}

async function startGeneration(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const payload = generationPayload();
  if (!payload.topic.trim()) return toast("글 주제를 입력해 주세요.");
  const existing = localStorage.getItem(ACTIVE_JOB_KEY);
  if (existing) {
    toast("이미 생성 중인 작업이 있습니다. 기존 작업 상태를 이어서 확인합니다.");
    return pollGenerationJob(existing);
  }
  minimized = false;
  ensureProgressUi();
  updateGenerationUi({ status: "queued", progress: 1, message: "모바일에서도 끊기지 않는 백그라운드 작업을 시작합니다." }, Date.now());
  try {
    const data = await requestJson("/api/generation-jobs", { method: "POST", body: JSON.stringify(payload) });
    const job = data.job;
    localStorage.setItem(ACTIVE_JOB_KEY, job.id);
    await pollGenerationJob(job.id, Date.now());
  } catch (error) {
    localStorage.removeItem(ACTIVE_JOB_KEY);
    hideGenerationUi();
    toast(error.message, 10000);
  }
}

async function openPendingDraft() {
  const draftId = localStorage.getItem(PENDING_DRAFT_KEY);
  if (!draftId) return;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const button = document.querySelector(`[data-open-draft="${CSS.escape(draftId)}"]`);
    if (button) {
      localStorage.removeItem(PENDING_DRAFT_KEY);
      button.click();
      return;
    }
    await sleep(500);
  }
}

function resumeActiveJob() {
  const jobId = localStorage.getItem(ACTIVE_JOB_KEY);
  if (!jobId) return;
  ensureProgressUi();
  updateGenerationUi({ status: "running", progress: 2, message: "진행 중이던 작업을 다시 연결하고 있습니다." }, Date.now());
  pollGenerationJob(jobId, Date.now());
}

const form = $("#generateForm");
if (form) form.addEventListener("submit", startGeneration, true);
ensureProgressUi();
ensureBackgroundBanner();
loadModelOptions();
updateFreshnessLabel();
resumeActiveJob();
openPendingDraft();
window.addEventListener("pageshow", resumeActiveJob);
document.addEventListener("visibilitychange", () => { if (!document.hidden) resumeActiveJob(); });
