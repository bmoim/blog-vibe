const SETTINGS_KEY = "blogger-ai-topic-engine-settings-v2";

const STRATEGIES = {
  balanced: {
    label: "수익형 균형 조합",
    purpose: "돈과 시간을 아끼는 생활 문제 해결 블로그로 운영한다. 보험·보장·청구 실무, 정부지원·생활비 절감, 스마트폰·AI 오류 해결을 균형 있게 다루며 검색 수요와 광고 수익 가능성을 함께 본다.",
    pillars: ["insurance", "claims", "support", "ai"],
    audience: "general"
  },
  insurance: {
    label: "보험 전문 블로그",
    purpose: "보험 가입 전 확인, 보장 분석, 실손·운전자보험, 보험금 청구 과정에서 독자가 실수하지 않도록 돕는 신뢰도 높은 보험 실무 블로그로 운영한다.",
    pillars: ["insurance", "claims", "support"],
    audience: "insurance"
  },
  savings: {
    label: "생활비·지원금 블로그",
    purpose: "정부지원, 세금, 환급, 생활비 절감, 가격 비교를 통해 가계 지출을 줄이고 받을 수 있는 혜택을 놓치지 않도록 돕는 생활경제 블로그로 운영한다.",
    pillars: ["support", "saving", "finance", "home"],
    audience: "selfemployed"
  },
  ai: {
    label: "AI·스마트폰 해결 블로그",
    purpose: "ChatGPT, 생성형 AI, 스마트폰, 앱과 온라인 서비스에서 발생하는 오류를 누구나 따라 할 수 있게 빠르고 정확하게 해결하는 IT 문제 해결 블로그로 운영한다.",
    pillars: ["ai", "mobile", "saving"],
    audience: "general"
  },
  evergreen: {
    label: "꾸준한 에버그린 블로그",
    purpose: "계절과 유행을 덜 타고 오랫동안 검색되는 건강, 가족, 집안 관리, 생활비 절감 문제를 실제 행동 단계와 체크리스트로 해결하는 생활정보 블로그로 운영한다.",
    pillars: ["health", "parenting", "home", "saving"],
    audience: "parents"
  },
  trend: {
    label: "최신 이슈 빠른 공략",
    purpose: "현재 시행 중인 정책 변경, 가격 변화, 새로운 AI 기능, 스마트폰 오류, 보험 제도 변화를 빠르게 확인하고 독자가 지금 해야 할 행동을 즉시 알려주는 최신 정보 블로그로 운영한다.",
    pillars: ["support", "ai", "mobile", "insurance"],
    audience: "general"
  }
};

const PILLARS = {
  insurance: { label: "보험·실손·운전자보험", expertise: "보험설계사 현장 경험과 보험 상품 구조를 쉽게 설명하는 능력" },
  claims: { label: "보험금 청구·보장 분석", expertise: "보험금 청구 절차와 보장 분석 경험, 고객이 자주 실수하는 부분을 설명하는 능력" },
  support: { label: "정부지원·세금·환급", expertise: "공식 기관 자료를 확인해 대상·조건·신청 절차를 쉽게 정리하는 능력" },
  saving: { label: "생활비 절감·가격 비교", expertise: "실제 생활비와 서비스 비용을 비교해 핵심 차이를 쉽게 설명하는 능력" },
  ai: { label: "ChatGPT·AI 활용", expertise: "AI 콘텐츠 제작과 ChatGPT·생성형 AI 도구를 실제 업무에 활용한 경험" },
  mobile: { label: "스마트폰·앱 오류 해결", expertise: "스마트폰과 앱의 오류 원인을 단계별로 확인하고 쉽게 해결하는 능력" },
  health: { label: "건강·병원·생활 건강", expertise: "건강 정보를 일반 독자가 이해하기 쉽게 정리하고 공식 의료 정보를 확인하는 능력" },
  parenting: { label: "육아·가족 생활", expertise: "아이를 키우며 겪는 실제 생활 문제와 가족 중심 정보를 현실적으로 설명하는 경험" },
  home: { label: "집안 관리·생활 서비스", expertise: "청소·수리·생활 서비스의 비용과 선택 기준을 실제 사용 관점에서 비교하는 능력" },
  finance: { label: "재테크·경제 기초", expertise: "복잡한 경제·금융 개념을 일반 독자가 이해할 수 있는 말로 풀어내는 능력" }
};

const AUDIENCES = {
  general: "보험·생활비·스마트폰 문제를 검색으로 해결하려는 한국의 30~60대 일반 독자",
  insurance: "보험 가입, 보장 점검, 보험금 청구 전에 정확한 정보를 확인하려는 한국의 40~60대 독자",
  parents: "육아, 가족 건강, 생활비, 집안 문제를 실용적으로 해결하려는 한국의 30~50대 부모",
  selfemployed: "세금, 지원금, 보험, 고정비 절감 정보를 찾는 한국의 자영업자·프리랜서",
  senior: "건강, 보험, 스마트폰 정보를 어렵지 않게 확인하려는 한국의 50~70대 중장년 독자"
};

let selectedStrategy = "balanced";
let selectedAudience = "general";
let selectedPillars = new Set(STRATEGIES.balanced.pillars);

export function calculateTopicGoal() {
  const goal = Number(document.querySelector("#monthlyGoal").value || 0);
  const rpm = Math.max(1, Number(document.querySelector("#estimatedRpm").value || 1));
  document.querySelector("#requiredPageviews").textContent = Math.ceil(goal / rpm * 1000).toLocaleString("ko-KR");
}

function updateChoiceStyles() {
  document.querySelectorAll("[data-strategy]").forEach((button) => {
    const selected = button.dataset.strategy === selectedStrategy;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  document.querySelectorAll("[data-audience]").forEach((button) => {
    const selected = button.dataset.audience === selectedAudience;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  document.querySelectorAll("#pillarChoices input[type='checkbox']").forEach((input) => {
    input.checked = selectedPillars.has(input.value);
    input.closest(".pill-choice")?.classList.toggle("selected", input.checked);
  });
}

function expertiseText() {
  const values = [...selectedPillars].map((key) => PILLARS[key]?.expertise).filter(Boolean);
  return [...new Set(values)].join(", ");
}

function pillarText() {
  return [...selectedPillars].map((key) => PILLARS[key]?.label).filter(Boolean).join(" | ");
}

function syncAdvancedFields() {
  const strategy = STRATEGIES[selectedStrategy] || STRATEGIES.balanced;
  document.querySelector("#sitePurpose").value = strategy.purpose;
  document.querySelector("#expertise").value = expertiseText();
  document.querySelector("#pillars").value = pillarText();
  document.querySelector("#topicAudience").value = AUDIENCES[selectedAudience] || AUDIENCES.general;
  document.querySelector("#pillarCount").textContent = `${selectedPillars.size}개 선택`;
  document.querySelector("#selectionSummary").textContent = `${strategy.label} · ${selectedPillars.size}개 분야 · ${document.querySelector(`[data-audience='${selectedAudience}'] strong`)?.textContent || "독자 선택"}`;
  updateChoiceStyles();
}

function selectStrategy(key) {
  if (!STRATEGIES[key]) return;
  selectedStrategy = key;
  selectedAudience = STRATEGIES[key].audience;
  selectedPillars = new Set(STRATEGIES[key].pillars);
  syncAdvancedFields();
}

function selectAudience(key) {
  if (!AUDIENCES[key]) return;
  selectedAudience = key;
  syncAdvancedFields();
}

function togglePillar(key, checked) {
  if (!PILLARS[key]) return;
  if (checked && !selectedPillars.has(key) && selectedPillars.size >= 4) {
    const input = document.querySelector(`#pillarChoices input[value='${CSS.escape(key)}']`);
    if (input) input.checked = false;
    window.alert("콘텐츠 분야는 최대 4개까지 선택할 수 있습니다.");
    return;
  }
  if (!checked && selectedPillars.size <= 1) {
    const input = document.querySelector(`#pillarChoices input[value='${CSS.escape(key)}']`);
    if (input) input.checked = true;
    window.alert("콘텐츠 분야를 최소 1개는 선택해야 합니다.");
    return;
  }
  if (checked) selectedPillars.add(key);
  else selectedPillars.delete(key);
  syncAdvancedFields();
}

function restoreSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch {}
  if (!saved) {
    selectStrategy("balanced");
    return;
  }
  selectedStrategy = STRATEGIES[saved.strategy] ? saved.strategy : "balanced";
  selectedAudience = AUDIENCES[saved.audienceChoice] ? saved.audienceChoice : STRATEGIES[selectedStrategy].audience;
  const validPillars = Array.isArray(saved.pillarChoices) ? saved.pillarChoices.filter((key) => PILLARS[key]) : [];
  selectedPillars = new Set(validPillars.length ? validPillars.slice(0, 4) : STRATEGIES[selectedStrategy].pillars);
  syncAdvancedFields();
  if (saved.sitePurpose) document.querySelector("#sitePurpose").value = saved.sitePurpose;
  if (saved.expertise) document.querySelector("#expertise").value = saved.expertise;
  if (saved.pillars) document.querySelector("#pillars").value = saved.pillars;
  if (saved.audience) document.querySelector("#topicAudience").value = saved.audience;
  if (saved.count) document.querySelector("#topicCount").value = String(saved.count);
  if (typeof saved.useSearchConsole === "boolean") document.querySelector("#useTopicSearchConsole").checked = saved.useSearchConsole;
}

export function setupTopicForm() {
  restoreSettings();
  document.querySelector("#monthlyGoal").addEventListener("input", calculateTopicGoal);
  document.querySelector("#estimatedRpm").addEventListener("input", calculateTopicGoal);
  document.querySelectorAll("[data-strategy]").forEach((button) => button.addEventListener("click", () => selectStrategy(button.dataset.strategy)));
  document.querySelectorAll("[data-audience]").forEach((button) => button.addEventListener("click", () => selectAudience(button.dataset.audience)));
  document.querySelectorAll("#pillarChoices input[type='checkbox']").forEach((input) => input.addEventListener("change", () => togglePillar(input.value, input.checked)));
  document.querySelector("#resetTopicDefaults").addEventListener("click", () => {
    localStorage.removeItem(SETTINGS_KEY);
    document.querySelector("#topicCount").value = "30";
    document.querySelector("#useTopicSearchConsole").checked = true;
    selectStrategy("balanced");
  });
}

export function readTopicForm() {
  const payload = {
    strategy: selectedStrategy,
    pillarChoices: [...selectedPillars],
    audienceChoice: selectedAudience,
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
