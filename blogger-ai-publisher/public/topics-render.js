const esc = (value) => String(value || "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
let activePlan = null;
let handlers = null;

function scoreGrid(topic) {
  const rows = [["수요",topic.scores?.demand],["수익 의도",topic.scores?.revenue_intent],["전문성",topic.scores?.authority_fit],["경쟁 기회",topic.scores?.competition_opportunity],["최신성",topic.scores?.freshness],["종합",topic.scores?.overall]];
  return rows.map(([name,value]) => `<div class="score-item"><span>${esc(name)}</span><strong>${Number(value || 0)}</strong></div>`).join("");
}

function actions(topic, compact = false) {
  return `<div class="topic-actions"><button class="button primary write-topic" data-id="${esc(topic.id)}">이 주제로 글쓰기</button>${compact ? "" : `<button class="button secondary copy-topic" data-id="${esc(topic.id)}">주제 복사</button><button class="button secondary skip-topic" data-id="${esc(topic.id)}">건너뛰기</button>`}</div>`;
}

function details(topic) {
  return `<details class="topic-details"><summary>선정 근거와 작성 방향</summary><p><strong>독자 문제:</strong> ${esc(topic.reader_problem)}</p><p><strong>차별화 각도:</strong> ${esc(topic.angle)}</p><p><strong>지금 쓰는 이유:</strong> ${esc(topic.why_now)}</p><p><strong>내 전문성 활용:</strong> ${esc(topic.authority_evidence)}</p><p><strong>기존 글과 차이:</strong> ${esc(topic.existing_gap)}</p><p><strong>확인할 공식 자료:</strong> ${esc((topic.official_sources_to_check || []).join(" · "))}</p><p><strong>광고·상업 의도:</strong> ${esc(topic.monetization_path)}</p>${topic.caution ? `<p><strong>주의:</strong> ${esc(topic.caution)}</p>` : ""}</details>`;
}

function findTopic(id) {
  return activePlan?.topics?.find((topic) => String(topic.id) === String(id));
}

function bindButtons() {
  document.querySelectorAll(".write-topic").forEach((button) => button.onclick = () => handlers.writeTopic(findTopic(button.dataset.id)));
  document.querySelectorAll(".copy-topic").forEach((button) => button.onclick = () => handlers.copyTopic(findTopic(button.dataset.id)));
  document.querySelectorAll(".skip-topic").forEach((button) => button.onclick = () => handlers.skipTopic(findTopic(button.dataset.id)));
}

function renderToday(plan) {
  const topics = [...(plan.topics || [])].filter((topic) => topic.status !== "skipped").sort((a,b) => Number(b.scores?.overall || 0) - Number(a.scores?.overall || 0) || a.day - b.day).slice(0,3);
  document.querySelector("#todayTopics").innerHTML = topics.map((topic) => `<article class="today-card"><span class="topic-score">${Number(topic.scores?.overall || 0)}</span><h3>${esc(topic.title)}</h3><p>${esc(topic.reader_problem)}</p><div class="topic-meta"><span class="topic-chip ${esc(topic.priority)}">${esc(topic.priority)}</span><span class="topic-chip">${esc(topic.cluster)}</span><span class="topic-chip">${esc(topic.estimated_effort)}</span></div>${actions(topic,true)}</article>`).join("");
}

function renderStrategy(plan) {
  document.querySelector("#topicPlanSummary").innerHTML = `<h3>${esc(plan.site_positioning)}</h3><p>${esc(plan.plan_summary)}</p><p><strong>운영 전략:</strong> ${esc(plan.monthly_strategy)}</p>`;
  document.querySelector("#topicClusters").innerHTML = (plan.clusters || []).map((cluster) => `<article class="cluster-card"><span class="cluster-share">${Number(cluster.share_percent || 0)}%</span><h3>${esc(cluster.name)}</h3><p>${esc(cluster.purpose)}</p><p><strong>기둥 글:</strong> ${esc(cluster.pillar_page)}</p></article>`).join("");
  const select = document.querySelector("#clusterFilter");
  const current = select.value;
  const names = [...new Set((plan.topics || []).map((topic) => topic.cluster).filter(Boolean))];
  select.innerHTML = '<option value="">전체 클러스터</option>' + names.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
  if (names.includes(current)) select.value = current;
}

function renderCalendar() {
  const cluster = document.querySelector("#clusterFilter").value;
  const priority = document.querySelector("#priorityFilter").value;
  const topics = (activePlan.topics || []).filter((topic) => (!cluster || topic.cluster === cluster) && (!priority || topic.priority === priority));
  document.querySelector("#topicCalendar").innerHTML = topics.length ? topics.map((topic) => `<article class="topic-card"><div class="topic-day"><div>DAY ${Number(topic.day)}<small>${esc(topic.status || "planned")}</small></div></div><div><div class="topic-meta"><span class="topic-chip ${esc(topic.priority)}">${esc(topic.priority)}</span><span class="topic-chip">${esc(topic.search_intent)}</span><span class="topic-chip">${esc(topic.content_type)}</span><span class="topic-chip">${esc(topic.cluster)}</span></div><h3>${esc(topic.title)}</h3><p><strong>핵심 키워드:</strong> ${esc(topic.primary_keyword)} · ${esc((topic.secondary_keywords || []).join(", "))}</p><div class="score-grid">${scoreGrid(topic)}</div>${details(topic)}</div>${actions(topic)}</article>`).join("") : '<p class="muted">조건에 맞는 주제가 없습니다.</p>';
}

export function renderTopicPlan(plan, nextHandlers) {
  activePlan = plan;
  handlers = nextHandlers;
  document.querySelector("#topicResultsSection").classList.remove("hidden");
  document.querySelector("#topicStrategySection").classList.remove("hidden");
  document.querySelector("#topicCalendarSection").classList.remove("hidden");
  document.querySelector("#topicSignalBadge").textContent = `Search Console 신호 ${Number(plan.searchConsoleSignalCount || 0)}개`;
  renderToday(plan);
  renderStrategy(plan);
  renderCalendar();
  bindButtons();
}

export function installTopicFilters(render) {
  document.querySelector("#clusterFilter").addEventListener("change", () => { renderCalendar(); bindButtons(); });
  document.querySelector("#priorityFilter").addEventListener("change", () => { renderCalendar(); bindButtons(); });
}
