const ACTIVE_JOB_KEY = "blogger-ai-active-generation-job";
const ACTIVE_JOB_STARTED_KEY = "blogger-ai-active-generation-started";
const PENDING_DRAFT_KEY = "blogger-ai-pending-draft";
const LAST_FAILED_JOB_KEY = "blogger-ai-last-failed-generation-job";
const SELECTED_MODEL_KEY = "blogger-ai-selected-text-model";
let pollingJobId = null;
let minimized = false;
let lastKnownJob = { status: "queued", progress: 1, message: "생성 작업을 준비하고 있습니다." };

const $ = (selector) => document.querySelector(selector);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 25000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchOptions = { ...options };
  delete fetchOptions.timeoutMs;
  try {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(fetchOptions.headers || {}) },
      cache: "no-store",
      ...fetchOptions,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `요청에 실패했습니다. (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`서버가 ${Math.round(timeoutMs / 1000)}초 동안 응답하지 않았습니다.`);
      timeoutError.code = "REQUEST_TIMEOUT";
      timeoutError.recoverable = true;
      throw timeoutError;
    }
    if (!error.status) error.recoverable = true;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toast(message, duration = 6000) {
  const element = $("#toast");
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.add("hidden"), duration);
}

function activeStartedAt() {
  const stored = Number(localStorage.getItem(ACTIVE_JOB_STARTED_KEY) || 0);
  return stored > 0 ? stored : Date.now();
}

function clearActiveJob() {
  localStorage.removeItem(ACTIVE_JOB_KEY);
  localStorage.removeItem(ACTIVE_JOB_STARTED_KEY);
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
  const status = document.createElement("p");
  status.id = "generationConnectionStatus";
  status.className = "generation-connection-status";
  status.textContent = "서버와 연결되어 있습니다.";
  const note = document.createElement("p");
  note.className = "generation-note";
  note.textContent = "모바일에서 다른 화면으로 이동해도 서버에서 생성은 계속됩니다. 다시 돌아오면 진행 상태를 이어서 확인합니다.";
  const actions = document.createElement("div");
  actions.className = "generation-actions";

  const minimizeButton = document.createElement("button");
  minimizeButton.id = "loadingMinimizeButton";
  minimizeButton.type = "button";
  minimizeButton.className = "button secondary";
  minimizeButton.textContent = "화면에서 숨기기";
  minimizeButton.addEventListener("click", () => {
    minimized = true;
    $("#loadingOverlay")?.classList.add("hidden");
    showBackgroundBanner();
  });

  const reconnectButton = document.createElement("button");
  reconnectButton.id = "generationReconnectButton";
  reconnectButton.type = "button";
  reconnectButton.className = "button secondary";
  reconnectButton.textContent = "상태 다시 확인";
  reconnectButton.addEventListener("click", () => {
    const jobId = localStorage.getItem(ACTIVE_JOB_KEY);
    if (!jobId) return toast("확인할 생성 작업이 없습니다.");
    pollingJobId = null;
    minimized = false;
    $("#loadingOverlay")?.classList.remove("hidden");
    pollGenerationJob(jobId, activeStartedAt());
  });

  const cancelButton = document.createElement("button");
  cancelButton.id = "generationCancelButton";
  cancelButton.type = "button";
  cancelButton.className = "button danger";
  cancelButton.textContent = "생성 중단";
  cancelButton.addEventListener("click", async () => {
    const jobId = localStorage.getItem(ACTIVE_JOB_KEY);
    if (!jobId) return hideGenerationUi();
    if (!confirm("현재 생성 작업을 중단할까요? 이미 처리된 API 사용량은 되돌릴 수 없습니다.")) return;
    cancelButton.disabled = true;
    try {
      await requestJson(`/api/generation-jobs/${encodeURIComponent(jobId)}`, { method: "DELETE", timeoutMs: 20000 });
      clearActiveJob();
      pollingJobId = null;
      hideGenerationUi();
      toast("생성 작업을 중단했습니다.");
    } catch (error) {
      toast(`중단 요청을 확인하지 못했습니다. ${error.message}`, 10000);
    } finally {
      cancelButton.disabled = false;
    }
  });

  actions.append(minimizeButton, reconnectButton, cancelButton);
  card.append(progress, meta, status, note, actions);
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

function updateGenerationUi(job = {}, startedAt = Date.now(), connectionMessage = "서버와 연결되어 있습니다.") {
  ensureProgressUi();
  ensureBackgroundBanner();
  const hasProgress = Number.isFinite(Number(job.progress));
  const progress = Math.max(0, Math.min(100, hasProgress ? Number(job.progress) : Number(lastKnownJob.progress || 0)));
  lastKnownJob = { ...lastKnownJob, ...job, progress };
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  $("#loadingTitle").textContent = job.status === "queued" ? "생성 작업을 준비하고 있습니다" : "콘텐츠를 만들고 있습니다";
  $("#loadingMessage").textContent = job.message || lastKnownJob.message || "최신 자료를 확인하고 있습니다.";
  $("#generationProgressBar").style.width = `${progress}%`;
  $("#generationProgressText").textContent = `${progress}%`;
  $("#generationElapsed").textContent = minutes ? `${minutes}분 ${seconds}초` : `${seconds}초`;
  const connection = $("#generationConnectionStatus");
  if (connection) {
    connection.textContent = connectionMessage;
    connection.classList.toggle("warning", !/연결되어|정상/.test(connectionMessage));
  }
  if (minimized) showBackgroundBanner(`${progress}% · ${job.message || lastKnownJob.message || "생성 중"}`);
  else $("#loadingOverlay")?.classList.remove("hidden");
}

async function loadModelOptions() {
  const select = $("#textModel");
  if (!select) return;
  try {
    const data = await requestJson("/api/models", { timeoutMs: 30000 });
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
    const status = await requestJson("/api/status", { timeoutMs: 15000 });
    const label = $("#freshnessDateLabel");
    if (label) label.textContent = `${status.currentDate || "오늘"} 기준 웹 검색·최신성 확인`;
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

async function pollGenerationJob(jobId, startedAt = activeStartedAt()) {
  if (!jobId || pollingJobId === jobId) return;
  pollingJobId = jobId;
  let networkFailures = 0;
  const deadline = Date.now() + 1000 * 60 * 30;
  try {
    while (Date.now() < deadline) {
      try {
        const data = await requestJson(`/api/generation-jobs/${encodeURIComponent(jobId)}?t=${Date.now()}`, { timeoutMs: 15000 });
        networkFailures = 0;
        const job = data.job;
        updateGenerationUi(job, startedAt, job.resumed ? "서버 재시작 후 작업을 자동 재개했습니다." : "서버와 정상 연결되어 있습니다.");
        if (job.status === "completed") {
          clearActiveJob();
          localStorage.removeItem(LAST_FAILED_JOB_KEY);
          localStorage.setItem(PENDING_DRAFT_KEY, job.draftId);
          hideGenerationUi();
          toast(job.warning || "글과 이미지 생성이 완료되었습니다. 초안을 불러옵니다.", job.warning ? 10000 : 6000);
          await sleep(500);
          location.href = `/?generatedDraft=${encodeURIComponent(job.draftId)}&t=${Date.now()}`;
          return;
        }
        if (job.status === "failed") {
          const error = new Error(job.error || job.message || "생성에 실패했습니다.");
          error.terminal = true;
          localStorage.setItem(LAST_FAILED_JOB_KEY, jobId);
          throw error;
        }
        if (job.status === "canceled") {
          const error = new Error("생성 작업이 중단되었습니다.");
          error.terminal = true;
          throw error;
        }
        await sleep(document.hidden ? 5000 : 2200);
      } catch (error) {
        if (error.terminal) throw error;
        if (error.status === 404) {
          error.terminal = true;
          throw error;
        }
        if (error.status === 401) {
          error.message = "로그인 인증이 만료되었습니다. 페이지를 새로고침하고 다시 로그인해 주세요.";
          error.terminal = true;
          throw error;
        }
        networkFailures += 1;
        const retryMessage = `서버 응답을 다시 확인하고 있습니다. 자동 재시도 ${networkFailures}/12`;
        updateGenerationUi({
          status: "running",
          progress: lastKnownJob.progress,
          message: lastKnownJob.message || "서버에서 생성 작업이 계속 진행 중입니다."
        }, startedAt, retryMessage);

        if (networkFailures === 4) {
          try {
            const healthResponse = await fetch(`/health?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
            if (healthResponse.ok) updateGenerationUi(lastKnownJob, startedAt, "서버는 정상이며 작업 상태 연결을 다시 시도하고 있습니다.");
          } catch {}
        }
        if (networkFailures >= 12) {
          const connectionError = new Error("서버 상태 연결이 3분 이상 불안정합니다. 생성 작업 번호는 보존했습니다. 페이지를 새로고침하면 자동으로 다시 연결됩니다.");
          connectionError.recoverable = true;
          throw connectionError;
        }
        await sleep(Math.min(12000, 2000 + networkFailures * 1000));
      }
    }
    const timeoutError = new Error("생성 시간이 30분을 초과했습니다. 작업 번호는 보존했으므로 상태 다시 확인을 누르거나 페이지를 새로고침해 주세요.");
    timeoutError.recoverable = true;
    throw timeoutError;
  } catch (error) {
    if (error.terminal) clearActiveJob();
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
    return pollGenerationJob(existing, activeStartedAt());
  }
  minimized = false;
  const startedAt = Date.now();
  lastKnownJob = { status: "queued", progress: 1, message: "백그라운드 생성 작업을 시작합니다." };
  ensureProgressUi();
  updateGenerationUi(lastKnownJob, startedAt);
  try {
    const data = await requestJson("/api/generation-jobs", { method: "POST", body: JSON.stringify(payload), timeoutMs: 30000 });
    const job = data.job;
    localStorage.setItem(ACTIVE_JOB_KEY, job.id);
    localStorage.setItem(ACTIVE_JOB_STARTED_KEY, String(startedAt));
    await pollGenerationJob(job.id, startedAt);
  } catch (error) {
    clearActiveJob();
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
  updateGenerationUi({ status: "running", progress: lastKnownJob.progress || 2, message: "진행 중이던 작업 상태를 다시 연결하고 있습니다." }, activeStartedAt());
  pollGenerationJob(jobId, activeStartedAt());
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
