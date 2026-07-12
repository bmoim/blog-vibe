(() => {
  const BILLING_URL = "https://platform.openai.com/settings/organization/billing/overview";
  const USAGE_URL = "https://platform.openai.com/usage";
  const LIMITS_URL = "https://platform.openai.com/settings/organization/limits";
  const QUOTA_PATTERN = /exceeded your current quota|insufficient_quota|run out of credits|maximum monthly spend|monthly usage limit|plan and billing details/i;
  let shown = false;

  function addStyles() {
    if (document.querySelector("#openaiQuotaStyles")) return;
    const style = document.createElement("style");
    style.id = "openaiQuotaStyles";
    style.textContent = `.openai-quota-overlay{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:20px;background:rgba(21,24,45,.72);backdrop-filter:blur(5px)}.openai-quota-card{width:min(560px,100%);padding:26px;border-radius:22px;background:#fff;box-shadow:0 30px 90px rgba(0,0,0,.28);color:#17182a}.openai-quota-icon{width:54px;height:54px;display:grid;place-items:center;margin-bottom:14px;border-radius:16px;background:#fff0ed;font-size:28px}.openai-quota-card h2{margin:0;font-size:23px;line-height:1.35}.openai-quota-card p{margin:10px 0 0;color:#596174;line-height:1.7}.openai-quota-steps{margin:18px 0 0;padding:15px 16px;border-radius:14px;background:#f6f7fb;color:#373d4d;line-height:1.8;font-size:14px}.openai-quota-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px}.openai-quota-actions a,.openai-quota-actions button{min-height:46px;display:flex;align-items:center;justify-content:center;border:0;border-radius:12px;text-decoration:none;font:inherit;font-weight:800;cursor:pointer}.openai-quota-primary{grid-column:1/-1;background:#5b4df5;color:#fff}.openai-quota-secondary{background:#eef0f5;color:#252938}.openai-quota-close{background:#fff;color:#656c7c;border:1px solid #dfe3eb!important}.openai-quota-note{font-size:12px!important;color:#777f90!important}@media(max-width:560px){.openai-quota-card{padding:21px}.openai-quota-actions{grid-template-columns:1fr}.openai-quota-primary{grid-column:auto}}`;
    document.head.appendChild(style);
  }

  function closePanel() {
    document.querySelector("#openaiQuotaOverlay")?.remove();
    shown = false;
  }

  function replaceRawText() {
    const friendly = "OpenAI API 크레딧 또는 월 사용 한도가 소진되었습니다. 결제·사용량 설정을 확인해 주세요.";
    for (const selector of ["#toast", "#topicToast", "#growthToast", "#loadingMessage", "#generationConnectionStatus"]) {
      const element = document.querySelector(selector);
      if (element && QUOTA_PATTERN.test(element.textContent || "")) element.textContent = friendly;
    }
  }

  function showPanel() {
    replaceRawText();
    if (shown) return;
    shown = true;
    addStyles();
    const overlay = document.createElement("div");
    overlay.id = "openaiQuotaOverlay";
    overlay.className = "openai-quota-overlay";
    overlay.innerHTML = `<div class="openai-quota-card" role="dialog" aria-modal="true"><div class="openai-quota-icon">💳</div><h2>OpenAI API 결제 한도 확인이 필요합니다</h2><p>프로그램 고장이 아니라 OpenAI API 크레딧이 소진됐거나 월 예산 한도에 도달한 상태입니다. 결제 설정을 정상화하기 전에는 AI 글·이미지·주제 생성이 실행되지 않습니다.</p><div class="openai-quota-steps">① 결제수단 또는 선불 크레딧 확인<br>② 현재 사용량 확인<br>③ 조직·프로젝트 월 예산 한도 확인<br>④ 설정 반영 후 프로그램에서 다시 생성</div><div class="openai-quota-actions"><a class="openai-quota-primary" href="${BILLING_URL}" target="_blank" rel="noopener">결제·크레딧 확인</a><a class="openai-quota-secondary" href="${USAGE_URL}" target="_blank" rel="noopener">사용량 확인</a><a class="openai-quota-secondary" href="${LIMITS_URL}" target="_blank" rel="noopener">월 예산 한도 확인</a><button class="openai-quota-close" type="button">닫기</button></div><p class="openai-quota-note">ChatGPT 구독과 OpenAI API 사용료는 별도로 관리됩니다.</p></div>`;
    overlay.querySelector("button").addEventListener("click", closePanel);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) closePanel(); });
    document.body.appendChild(overlay);
  }

  function inspect(value) {
    let text = "";
    try { text = typeof value === "string" ? value : JSON.stringify(value); } catch { text = String(value || ""); }
    if (!QUOTA_PATTERN.test(text)) return false;
    showPanel();
    return true;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) response.clone().json().then(inspect).catch(() => null);
    else if (response.status === 429) response.clone().text().then(inspect).catch(() => null);
    return response;
  };

  function start() {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") inspect(mutation.target.textContent || "");
        for (const node of mutation.addedNodes) inspect(node.textContent || "");
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    inspect(document.body.textContent || "");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
