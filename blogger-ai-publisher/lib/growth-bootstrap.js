import express from "express";
import { createGrowthRouter, startGrowthScheduler } from "./growth-router.js";

const originalListen = express.application.listen;

if (!express.application.__growthCenterPatched) {
  Object.defineProperty(express.application, "__growthCenterPatched", { value: true, configurable: false });
  express.application.listen = function patchedListen(...args) {
    if (!this.locals.__growthCenterInstalled) {
      this.locals.__growthCenterInstalled = true;
      this.use("/api/growth", createGrowthRouter());
      startGrowthScheduler();
    }
    return originalListen.apply(this, args);
  };
}
