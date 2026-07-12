const resultList = document.querySelector("#queryResultList");
const resultSearch = document.querySelector("#queryResultSearch");
const resultType = document.querySelector("#queryResultType");
const refreshButton = document.querySelector("#refreshQueryResults");
let latestStatus = null;

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[character]);
}

function summarize(item) {
  const result = item.result || {};
  if (result.truncated) return result.summary || "큰 결과의 핵심 정보만 저장했습니다.";
  if (result.searchConsole?.totals) {
    const totals = result.searchConsole.totals;
    return `검색 클릭 ${Number(totals.clicks || 0).toLocaleString("ko-KR")} · 노출 ${Number(totals.impressions || 0).toLocaleString("ko-KR")} · CTR ${(Number(totals.ctr || 0) * 100).toFixed(1)}%`;
  }
  if (result.quality) return `품질 점수 ${Number(result.quality.score || 0)}점 · ${result.quality.pass ? "통과" : "개선 필요"}`;
  if (result.audit) return result.audit.summary || `최신성 문제 ${result.audit.issues?.length || 0}건`;
  if (result.matches) return `유사 글 ${result.matches.length}개 · 위험도 ${result.risk || "확인 필요"}`;
  if (result.suggestions) return `추천 내부링크 ${result.suggestions.length}개`;
  if (result.variants) return `제목 후보 ${result.variants.title_options?.length || 0}개 · 썸네일 후보 ${result.variants.thumbnail_options?.length || 0}개`;
  if (result.plan) return `${result.plan.topics?.length || 0}개 주제 · Search Console 신호 ${result.plan.searchConsoleSignalCount || 0}개`;
  if (result.indexStatus) return `색인 판정 ${result.indexStatus.verdict || "UNKNOWN"} · ${result.indexStatus.coverageState || "상태 확인 필요"}`;
  if (typeof result.total === "number" && Array.isArray(result.results)) return `링크 ${result.total}개 확인 · 정상 ${result.ok || 0}개 · 문제 ${result.broken?.length || 0}개`;
  if (Array.isArray(result.candidates)) return `업데이트 후보 ${result.candidates.length}개`;
  return `${Object.keys(result).length}개 데이터 항목이 저장되었습니다.`;
}

function renderResults(results) {
  if (!resultList) return;
  if (!results.length) {
    resultList.innerHTML = '<p class="muted">아직 저장된 조회·분석 결과가 없습니다. 성장 센터에서 분석을 실행하면 여기에 남습니다.</p>';
    return;
  }
  resultList.innerHTML = results.map((item) => {
    const resultJson = JSON.stringify(item.result || {}, null, 2);
    return `<article class="query-result-item">
      <div class="history-item-head">
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(summarize(item))}</p>
          ${item.query ? `<p class="query-context"><strong>대상:</strong> ${escapeHtml(item.query)}</p>` : ""}
        </div>
        <time>${new Date(item.createdAt).toLocaleString("ko-KR")}</time>
      </div>
      <div class="history-meta">
        <span class="history-chip">${escapeHtml(item.type)}</span>
        <span class="history-chip">${escapeHtml(item.path || "")}</span>
      </div>
      <details class="saved-result-details">
        <summary>저장된 전체 결과 보기</summary>
        <pre>${escapeHtml(resultJson)}</pre>
      </details>
    </article>`;
  }).join("");
}

function addQueryResultMetric(status = latestStatus) {
  latestStatus = status || latestStatus;
  const metrics = document.querySelector("#persistenceMetrics");
  if (!metrics || !latestStatus) return;
  let card = metrics.querySelector('[data-query-result-metric="true"]');
  if (!card) {
    card = document.createElement("div");
    card.className = "history-metric";
    card.dataset.queryResultMetric = "true";
    metrics.appendChild(card);
  }
  card.innerHTML = `<span>저장된 조회 결과</span><strong>${Number(latestStatus.counts?.queryResults || 0).toLocaleString("ko-KR")}</strong>`;
}

async function loadResults() {
  if (!resultList) return;
  const search = encodeURIComponent(resultSearch?.value.trim() || "");
  const type = encodeURIComponent(resultType?.value || "");
  const response = await fetch(`/api/growth/history/results?limit=300&search=${search}&type=${type}`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "저장된 조회 결과를 불러오지 못했습니다.");
  addQueryResultMetric(data.status);
  renderResults(data.results || []);
}

const metrics = document.querySelector("#persistenceMetrics");
if (metrics) new MutationObserver(() => addQueryResultMetric()).observe(metrics, { childList: true });

let searchTimer;
resultSearch?.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadResults().catch((error) => {
    resultList.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }), 350);
});
resultType?.addEventListener("change", () => loadResults());
refreshButton?.addEventListener("click", () => loadResults());
loadResults().catch((error) => {
  if (resultList) resultList.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
});
