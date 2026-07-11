const SETTINGS_KEY = "blogger-ai-topic-engine-settings-v1";
const defaults = {
  sitePurpose: "돈과 시간을 아끼는 생활 문제 해결 블로그. 보험·보장·청구 실무, 정부지원·생활비 절감, 스마트폰·AI·ChatGPT 오류 해결을 중심으로 한다.",
  expertise: "보험설계사 현장 경험, 보험금 청구와 보장 분석 경험, AI 콘텐츠 제작과 블로그 운영 경험, 실제 생활 문제를 쉽게 설명하는 능력",
  pillars: "보험·실손·운전자보험·보험금 청구 | 정부지원·세금·생활비 절감 | 스마트폰·AI·ChatGPT 오류 해결",
  audience: "보험·생활비·스마트폰 문제를 검색으로 해결하려는 한국의 30~60대 일반 독자"
};

export function calculateTopicGoal() {
  const goal = Number(document.querySelector("#monthlyGoal").value || 0);
  const rpm = Math.max(1, Number(document.querySelector("#estimatedRpm").value || 1));
  document.querySelector("#requiredPageviews").textContent = Math.ceil(goal / rpm * 1000).toLocaleString("ko-KR");
}

function applySettings(value) {
  const saved = value || defaults;
  document.querySelector("#sitePurpose").value = saved.sitePurpose || defaults.sitePurpose;
  document.querySelector("#expertise").value = saved.expertise || defaults.expertise;
  document.querySelector("#pillars").value = saved.pillars || defaults.pillars;
  document.querySelector("#topicAudience").value = saved.audience || defaults.audience;
}

export function setupTopicForm() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch {}
  applySettings(saved);
  document.querySelector("#monthlyGoal").addEventListener("input", calculateTopicGoal);
  document.querySelector("#estimatedRpm").addEventListener("input", calculateTopicGoal);
  document.querySelector("#resetTopicDefaults").addEventListener("click", () => {
    localStorage.removeItem(SETTINGS_KEY);
    applySettings(defaults);
  });
}

export function readTopicForm() {
  const payload = {
    sitePurpose: document.querySelector("#sitePurpose").value,
    expertise: document.querySelector("#expertise").value,
    pillars: document.querySelector("#pillars").value,
    audience: document.querySelector("#topicAudience").value,
    monthlyRevenueGoal: Number(document.querySelector("#monthlyGoal").value || 50000000),
    count: Number(document.querySelector("#topicCount").value || 30),
    useSearchConsole: document.querySelector("#useTopicSearchConsole").checked
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
  return payload;
}
