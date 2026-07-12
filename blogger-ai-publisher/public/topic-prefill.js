const PREFILL_KEY = "blogger-ai-topic-prefill-v1";

function showPrefillToast(message) {
  const element = document.querySelector("#toast");
  if (!element) return;
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(showPrefillToast.timer);
  showPrefillToast.timer = setTimeout(() => element.classList.add("hidden"), 7000);
}

function addTopicEngineLink() {
  const actions = document.querySelector(".top-actions");
  if (!actions || actions.querySelector('[href="/topics.html"]')) return;
  const link = document.createElement("a");
  link.className = "button primary";
  link.href = "/topics.html";
  link.textContent = "주제 발굴실";
  actions.prepend(link);
}

function applyTopicPrefill() {
  let value;
  try { value = JSON.parse(localStorage.getItem(PREFILL_KEY) || "null"); } catch {}
  if (!value) return;
  const topic = document.querySelector("#topic");
  const keyword = document.querySelector("#targetKeyword");
  const audience = document.querySelector("#audience");
  const instructions = document.querySelector("#customInstructions");
  if (!topic || !keyword || !audience || !instructions) return;

  topic.value = value.topic || "";
  keyword.value = value.targetKeyword || "";
  audience.value = value.audience || audience.value;
  instructions.value = value.customInstructions || "";
  localStorage.removeItem(PREFILL_KEY);
  topic.focus();
  topic.scrollIntoView({ behavior: "smooth", block: "center" });
  showPrefillToast("주제 발굴실에서 선택한 내용으로 글 작성 폼을 채웠습니다.");
}

addTopicEngineLink();
applyTopicPrefill();
