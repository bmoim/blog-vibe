const setupSection = document.querySelector(".growth-setup");
const setupHeading = setupSection?.querySelector(".section-heading");
const siteSelect = document.querySelector("#growthSiteSelect");
const siteInput = document.querySelector("#growthSiteUrl");
const ga4Input = document.querySelector("#growthGa4Property");
const adsenseInput = document.querySelector("#growthAdsenseAccount");
const toastElement = document.querySelector("#growthToast");
const loadingOverlay = document.querySelector("#growthLoading");

function esc(value) {
  return String(value || "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]);
}

function toast(message, duration = 7000) {
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastElement.classList.add("hidden"), duration);
}

function loading(active) {
  if (!loadingOverlay) return;
  document.querySelector("#growthLoadingTitle").textContent = "Google 연결 정보를 자동으로 찾고 있습니다";
  document.querySelector("#growthLoadingMessage").textContent = "Search Console, GA4, AdSense 계정을 확인하고 있습니다.";
  loadingOverlay.classList.toggle("hidden", !active);
}

function attachDatalist(input, id, items, labeler) {
  let list = document.querySelector(`#${id}`);
  if (!list) {
    list = document.createElement("datalist");
    list.id = id;
    document.body.appendChild(list);
  }
  list.innerHTML = items.map((item) => `<option value="${esc(item.id)}">${esc(labeler(item))}</option>`).join("");
  input?.setAttribute("list", id);
}

async function discover() {
  loading(true);
  try {
    const response = await fetch("/api/growth/connections/discover", { cache: "no-store", headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Google 연결 정보를 불러오지 못했습니다.");

    const sites = data.searchConsole?.items || [];
    if (siteSelect) {
      siteSelect.innerHTML = '<option value="">속성 선택</option>' + sites.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.permission || "")}</option>`).join("");
    }
    if (!siteInput?.value && sites[0]) siteInput.value = sites[0].id;

    const properties = data.ga4?.items || [];
    attachDatalist(ga4Input, "ga4PropertyOptions", properties, (item) => `${item.name} · ${item.accountName}`);
    if (!ga4Input?.value && properties[0]) ga4Input.value = properties[0].id;

    const accounts = data.adsense?.items || [];
    attachDatalist(adsenseInput, "adsenseAccountOptions", accounts, (item) => `${item.name} · ${item.state}`);
    if (!adsenseInput?.value && accounts[0]) adsenseInput.value = accounts[0].id;

    const errors = [data.searchConsole?.error, data.ga4?.error, data.adsense?.error].filter(Boolean);
    const found = `Search Console ${sites.length}개 · GA4 ${properties.length}개 · AdSense ${accounts.length}개`;
    toast(errors.length ? `${found}\n일부 조회 실패: ${errors.join(" / ")}` : `${found}를 찾았습니다. 확인 후 설정 저장을 누르세요.`, 10000);
  } catch (error) {
    toast(`${error.message} Google 권한을 다시 연결한 뒤 재시도하세요.`, 10000);
  } finally {
    loading(false);
  }
}

if (setupHeading) {
  const existing = setupHeading.querySelector(".policy-note");
  const button = document.createElement("button");
  button.className = "button primary";
  button.type = "button";
  button.textContent = "Google 연결 자동 찾기";
  button.addEventListener("click", discover);
  if (existing) existing.replaceWith(button);
  else setupHeading.appendChild(button);
}
