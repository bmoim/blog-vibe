import express from "express";
import { generateTopicPlan } from "./topic-generator.js";
import { listTopicPlans, getLatestTopicPlan, updateTopicStatus } from "./topic-plan-storage.js";

const router = express.Router();

router.post("/topics/generate", async (req, res) => {
  res.json({ plan: await generateTopicPlan(req.body || {}) });
});

router.get("/topics/latest", async (req, res) => {
  res.json({ plan: await getLatestTopicPlan() });
});

router.get("/topics/plans", async (req, res) => {
  res.json({ plans: await listTopicPlans() });
});

router.post("/topics/:planId/:topicId/status", async (req, res) => {
  const allowed = ["planned", "writing", "published", "skipped"];
  const status = allowed.includes(req.body?.status) ? req.body.status : "planned";
  const topic = await updateTopicStatus(req.params.planId, req.params.topicId, status);
  if (!topic) return res.status(404).json({ error: "주제 계획을 찾을 수 없습니다." });
  res.json({ topic });
});

export function createTopicEngineRouter() {
  return router;
}
