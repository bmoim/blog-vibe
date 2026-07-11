import express from "express";
import { createGrowthRouter, startGrowthScheduler } from "./growth-router.js";
import { createGrowthBackupRouter } from "./growth-backup-router.js";
import { createPublishedUpdateRouter } from "./published-update-router.js";
import { createSiteHealthRouter } from "./site-health-router.js";
import { createQualityGateRouter } from "./quality-gate-router.js";
import { createConnectionDiscoveryRouter } from "./connection-discovery-router.js";
import { createGooglePersistenceRouter } from "./google-persistence-router.js";
import { createTopicEngineRouter } from "./topic-engine-router.js";
import { createCitationCleanupRouter } from "./citation-cleanup-router.js";
import { createPersistenceRouter } from "./persistence-router.js";
import { appendActivity } from "./activity-history.js";
import {
  closePersistentData,
  initializePersistentData,
  startPersistentDataWatchers
} from "./persistent-data.js";

await initializePersistentData();

function captureActivity(type, title, details) {
  return (req, res, next) => {
    const startedAt = Date.now();
    res.once("finish", () => {
      const payload = details(req) || {};
      appendActivity({
        type,
        title: typeof title === "function" ? title(req) : title,
        query: payload.query || "",
        metadata: {
          ...payload.metadata,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt
        },
        status: res.statusCode < 400 ? "completed" : "failed"
      }).catch((error) => console.error("Activity history write failed:", error));
    });
    next();
  };
}

const originalPost = express.application.post;
const originalGet = express.application.get;

express.application.post = function patchedPost(path, ...handlers) {
  if (path === "/api/generation-jobs" || path === "/api/generate") {
    handlers.unshift(captureActivity("article-generation", "블로그 글 생성 조회", (req) => ({
      query: String(req.body?.topic || ""),
      metadata: {
        targetKeyword: req.body?.targetKeyword || "",
        textModel: req.body?.textModel || "",
        imageCount: Number(req.body?.imageCount || 0),
        articleLength: Number(req.body?.articleLength || 0)
      }
    })));
  } else if (path === "/api/blogs/lookup") {
    handlers.unshift(captureActivity("blog-lookup", "Blogger 블로그 주소 조회", (req) => ({ query: String(req.body?.url || "") })));
  } else if (path === "/api/publish") {
    handlers.unshift(captureActivity("blog-publish", (req) => req.body?.isDraft ? "Blogger 초안 전송" : "Blogger 공개 발행", (req) => ({
      query: String(req.body?.draftId || ""),
      metadata: { blogId: req.body?.blogId || "", isDraft: Boolean(req.body?.isDraft) }
    })));
  }
  return originalPost.call(this, path, ...handlers);
};

express.application.get = function patchedGet(path, ...handlers) {
  if (path === "/api/drafts/:id") {
    handlers.unshift(captureActivity("draft-view", "저장된 초안 열람", (req) => ({ query: String(req.params?.id || "") })));
  }
  return originalGet.call(this, path, ...handlers);
};

const originalListen = express.application.listen;

if (!express.application.__growthCenterPatched) {
  Object.defineProperty(express.application, "__growthCenterPatched", { value: true, configurable: false });
  express.application.listen = function patchedListen(...args) {
    if (!this.locals.__growthCenterInstalled) {
      this.locals.__growthCenterInstalled = true;
      this.use("/api/growth/schedules", (req, res, next) => {
        if (req.method === "POST" && typeof req.body?.publishAt === "string" && !/(?:Z|[+-]\d{2}:\d{2})$/.test(req.body.publishAt)) {
          req.body.publishAt = `${req.body.publishAt}+09:00`;
        }
        next();
      });
      this.use("/api/growth", createGrowthBackupRouter());
      this.use("/api/growth", createPublishedUpdateRouter());
      this.use("/api/growth", createSiteHealthRouter());
      this.use("/api/growth", createQualityGateRouter());
      this.use("/api/growth", createConnectionDiscoveryRouter());
      this.use("/api/growth", createGooglePersistenceRouter());
      this.use("/api/growth", createTopicEngineRouter());
      this.use("/api/growth", createCitationCleanupRouter());
      this.use("/api/growth", createPersistenceRouter());
      this.use("/api/growth", createGrowthRouter());
      this.use("/api/growth", (error, req, res, next) => {
        console.error(error);
        const message = error?.response?.data?.error?.message || error?.response?.data?.error || error.message || "성장 센터 처리 중 오류가 발생했습니다.";
        res.status(error.status || error?.response?.status || 500).json({ error: String(message) });
      });
      startGrowthScheduler();
      startPersistentDataWatchers().catch((error) => console.error("Persistent data watcher failed:", error));
    }
    return originalListen.apply(this, args);
  };
}

let shuttingDown = false;
async function shutdownPersistence() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await closePersistentData();
  } finally {
    process.exit(0);
  }
}
process.once("SIGTERM", shutdownPersistence);
process.once("SIGINT", shutdownPersistence);
