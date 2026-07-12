import { setupTopicForm, readTopicForm, calculateTopicGoal } from "./topics-form.js";
import { renderTopicPlan, installTopicFilters } from "./topics-render.js";

const state = { plan: null };
const toastElement = document.querySelector("#topicToast");
const loadingElement = document.querySelector("#topicLoading");

function toast(message, duration = 7000) {
  toastElement.textContent = message;
  toastElement.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastElement.classList.add("hidden"), duration);
}

function loading(active) {
  loadingElement.classList.toggle("hidden", !active);
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

async function updateStatus(topic, status) {
  if (!state.plan || !topic) return;
  await api(`/api/growth/topics/${encodeURIComponent(state.plan.id)}/${encodeURIComponent(topic.id)}/status`, {
    method: "POST",
    body: JSON.stringify({ status })
  });
  topic.status = status;
  render();
}

async function writeTopic(topic) {
  const audience = document.querySelector("#topicAudience").value;
  localStorage.setItem("blogger-ai-topic-prefill-v1", JSON.stringify({
    topic: topic.title,
    targetKeyword: topic.primary_keyword,
    audience,
    customInstructions: [
      `검색 의도: ${topic.search_intent}`,
      `독자 문제: ${topic.reader_problem}`,
      `차별화 각도: ${topic.angle}`,
      `지금 작성하는 이유: ${topic.why_now}`,
      `기존 글과 차이: ${topic.existing_gap}`,
      `내 경험 활용: ${topic.authority_evidence}`,
      `확인할 공식 자료: ${(topic.official_sources_to_check || []).join(", ")}`,
      `주의사항: ${topic.caution || "없음"}`,
      `보조 키워드: ${(topic.secondary_keywords || []).join(", ")}`
    ].join("\n")
  }));
  await updateStatus(topic, "writing").catch(() => null);
  location.href = "/?topicPrefill=1";
}

function render() {
  if (!state.plan) return;
  renderTopicPlan(state.plan, {
    writeTopic,
    skipTopic: (topic) => updateStatus(topic, "skipped"),
    copyTopic: async (topic) => {
      await navigator.clipboard.writeText(`${topic.title}\n핵심 키워드: ${topic.primary_keyword}\n작성 각도: ${topic.angle}`);
      toast("주제를 복사했습니다.");
    }
  });
}

async function generatePlan() {
  loading(true);
  try {
    const payload = readTopicForm();
    const { plan } = await api("/api/growth/topics/generate", { method: "POST", body: JSON.stringify(payload) });
    state.plan = plan;
    render();
    toast("한 달 주제 계획을 만들었습니다. 오늘 쓸 글 3개부터 시작하세요.", 9000);
    document.querySelector("#topicResultsSection").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    toast(error.message, 10000);
  } finally {
    loading(false);
  }
}

setupTopicForm();
installTopicFilters(render);
document.querySelector("#generateTopicPlan").addEventListener("click", generatePlan);
calculateTopicGoal();

(async function init() {
  try {
    const { plan } = await api("/api/growth/topics/latest");
    if (plan) {
      state.plan = plan;
      render();
    }
  } catch (error) {
    toast(error.message, 8000);
  }
})();
