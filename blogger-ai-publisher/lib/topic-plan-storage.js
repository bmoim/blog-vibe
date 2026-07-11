import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { dataDirectory } from "./storage.js";

const TOPIC_PLANS_FILE = path.join(dataDirectory, "topic-plans.json");

async function readPlans() {
  try {
    const value = JSON.parse(await fs.readFile(TOPIC_PLANS_FILE, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writePlans(plans) {
  await fs.mkdir(dataDirectory, { recursive: true });
  const temp = `${TOPIC_PLANS_FILE}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(plans, null, 2), "utf8");
  await fs.rename(temp, TOPIC_PLANS_FILE);
}

export async function saveTopicPlan(plan) {
  const plans = await readPlans();
  const record = {
    ...plan,
    id: plan.id || crypto.randomUUID(),
    createdAt: plan.createdAt || new Date().toISOString(),
    topics: (plan.topics || []).map((topic, index) => ({
      ...topic,
      id: topic.id || crypto.randomUUID(),
      day: Number(topic.day || index + 1),
      status: topic.status || "planned"
    }))
  };
  plans.unshift(record);
  await writePlans(plans.slice(0, 12));
  return record;
}

export async function listTopicPlans() {
  return (await readPlans()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getLatestTopicPlan() {
  return (await listTopicPlans())[0] || null;
}

export async function updateTopicStatus(planId, topicId, status) {
  const plans = await readPlans();
  const planIndex = plans.findIndex((plan) => plan.id === planId);
  if (planIndex < 0) return null;
  const topicIndex = (plans[planIndex].topics || []).findIndex((topic) => topic.id === topicId);
  if (topicIndex < 0) return null;
  plans[planIndex].topics[topicIndex] = {
    ...plans[planIndex].topics[topicIndex],
    status,
    statusUpdatedAt: new Date().toISOString()
  };
  await writePlans(plans);
  return plans[planIndex].topics[topicIndex];
}
