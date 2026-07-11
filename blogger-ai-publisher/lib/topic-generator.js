import OpenAI from "openai";
import { TOPIC_PLAN_SCHEMA } from "./topic-plan-schema.js";
import { collectTopicSignals } from "./topic-signals.js";
import { defaultTopicInputs, buildTopicPrompt } from "./topic-prompt.js";
import { saveTopicPlan } from "./topic-plan-storage.js";
import { appendActivity } from "./activity-history.js";

function safeText(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function koreaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function modelName(requested) {
  const value = safeText(requested, 100) || process.env.OPENAI_TEXT_MODEL || "gpt-5.6";
  return value === "gpt-5.6-terra" ? "gpt-5.6" : value;
}

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: Number(process.env.OPENAI_TIMEOUT_MS || 540000),
    maxRetries: 2
  });
}

function normalizePlan(plan, count, input, signals) {
  return {
    ...plan,
    generatedFor: input,
    searchConsoleSignalCount: signals.length,
    topics: (plan.topics || []).slice(0, count).map((topic, index) => ({
      ...topic,
      id: safeText(topic.id, 100) || `topic-${index + 1}`,
      day: index + 1,
      status: "planned"
    }))
  };
}

export async function generateTopicPlan(body = {}) {
  const defaults = defaultTopicInputs();
  const count = Math.max(10, Math.min(40, Number(body.count || 30)));
  const input = {
    sitePurpose: safeText(body.sitePurpose, 1200) || defaults.sitePurpose,
    expertise: safeText(body.expertise, 1200) || defaults.expertise,
    pillars: safeText(body.pillars, 1200) || defaults.pillars,
    audience: safeText(body.audience, 500) || defaults.audience,
    monthlyRevenueGoal: Math.max(0, Number(body.monthlyRevenueGoal || 50000000)),
    count,
    textModel: safeText(body.textModel, 100) || process.env.OPENAI_TEXT_MODEL || "gpt-5.6",
    useSearchConsole: body.useSearchConsole !== false
  };

  const { drafts, searchSignals } = await collectTopicSignals(input.useSearchConsole);
  const currentDate = koreaDate();
  const response = await client().responses.create({
    model: modelName(input.textModel),
    reasoning: { effort: "low" },
    instructions: `최신 웹 조사와 운영자의 실제 경험을 함께 반영하는 한국어 블로그 주제 전략가다. 오늘은 ${currentDate}다.`,
    input: buildTopicPrompt({ input, count, drafts, searchSignals, currentDate }),
    max_output_tokens: 16000,
    tools: [{ type: "web_search", search_context_size: "high" }],
    tool_choice: "required",
    text: {
      format: {
        type: "json_schema",
        name: "blog_topic_plan",
        strict: true,
        schema: TOPIC_PLAN_SCHEMA
      }
    }
  });

  if (!response.output_text) throw new Error("주제 추천 결과가 비어 있습니다.");
  let parsed;
  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    throw new Error("주제 추천 데이터를 해석하지 못했습니다. 다시 생성해 주세요.");
  }
  const plan = await saveTopicPlan(normalizePlan(parsed, count, input, searchSignals));
  await appendActivity({
    type: "topic-plan",
    title: "한 달 블로그 주제 계획 생성",
    query: input.pillars,
    metadata: {
      count: plan.topics?.length || count,
      monthlyRevenueGoal: input.monthlyRevenueGoal,
      searchConsoleSignals: searchSignals.length,
      topTopics: (plan.topics || []).slice(0, 5).map((topic) => topic.title)
    }
  }).catch(() => null);
  return plan;
}
