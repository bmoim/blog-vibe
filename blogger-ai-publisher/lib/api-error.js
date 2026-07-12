const OPENAI_BILLING_URL = "https://platform.openai.com/settings/organization/billing/overview";
const OPENAI_USAGE_URL = "https://platform.openai.com/usage";
const OPENAI_LIMITS_URL = "https://platform.openai.com/settings/organization/limits";
const OPENAI_KEYS_URL = "https://platform.openai.com/api-keys";

function rawMessage(error) {
  const nested = error?.response?.data?.error;
  if (typeof nested === "string") return nested;
  return String(nested?.message || error?.error?.message || error?.message || "처리 중 오류가 발생했습니다.");
}

function rawCode(error) {
  return String(
    error?.response?.data?.error?.code ||
    error?.response?.data?.code ||
    error?.error?.code ||
    error?.code ||
    ""
  );
}

export function normalizeApiError(error, fallbackMessage = "처리 중 오류가 발생했습니다.") {
  const originalMessage = rawMessage(error) || fallbackMessage;
  const originalCode = rawCode(error);
  const status = Number(error?.status || error?.response?.status || 500);
  const combined = `${originalCode} ${originalMessage}`.toLowerCase();

  if (status === 429 && /(insufficient_quota|exceeded your current quota|billing|run out of credits|maximum monthly spend|usage limit)/i.test(combined)) {
    return {
      status: 429,
      code: "OPENAI_QUOTA_EXCEEDED",
      error: "OpenAI API 크레딧이 소진됐거나 월 사용 한도에 도달했습니다. 결제수단·크레딧 잔액·월 예산을 확인한 뒤 다시 시도해 주세요.",
      detail: originalMessage,
      retryable: false,
      helpUrls: {
        billing: OPENAI_BILLING_URL,
        usage: OPENAI_USAGE_URL,
        limits: OPENAI_LIMITS_URL
      }
    };
  }

  if (status === 429) {
    return {
      status: 429,
      code: "OPENAI_RATE_LIMITED",
      error: "OpenAI API 요청 한도에 잠시 도달했습니다. 약 1분 뒤 다시 시도해 주세요.",
      detail: originalMessage,
      retryable: true,
      helpUrls: { usage: OPENAI_USAGE_URL, limits: OPENAI_LIMITS_URL }
    };
  }

  if (status === 401 && /(api key|authentication|incorrect|invalid)/i.test(combined)) {
    return {
      status: 401,
      code: "OPENAI_API_KEY_INVALID",
      error: "OpenAI API 키가 올바르지 않거나 만료·삭제됐습니다. Render의 OPENAI_API_KEY를 새 키로 교체해 주세요.",
      detail: originalMessage,
      retryable: false,
      helpUrls: { apiKeys: OPENAI_KEYS_URL }
    };
  }

  return {
    status: status >= 400 && status <= 599 ? status : 500,
    code: originalCode || "APP_ERROR",
    error: originalMessage || fallbackMessage,
    detail: originalMessage,
    retryable: status >= 500,
    helpUrls: null
  };
}

export function apiErrorPayload(error, fallbackMessage) {
  const normalized = normalizeApiError(error, fallbackMessage);
  return {
    error: normalized.error,
    code: normalized.code,
    detail: normalized.detail,
    retryable: normalized.retryable,
    helpUrls: normalized.helpUrls
  };
}
