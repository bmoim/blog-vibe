import express from "express";
import { createGrowthRouter, startGrowthScheduler } from "./growth-router.js";
import { createGrowthBackupRouter } from "./growth-backup-router.js";

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
      this.use("/api/growth", createGrowthRouter());
      this.use("/api/growth", (error, req, res, next) => {
        console.error(error);
        const message = error?.response?.data?.error?.message || error?.response?.data?.error || error.message || "성장 센터 처리 중 오류가 발생했습니다.";
        res.status(error.status || error?.response?.status || 500).json({ error: String(message) });
      });
      startGrowthScheduler();
    }
    return originalListen.apply(this, args);
  };
}
