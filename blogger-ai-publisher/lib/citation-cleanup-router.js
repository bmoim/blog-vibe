import express from "express";
import { listDrafts, getDraft, saveDraft } from "./storage.js";
import { snapshotDraftVersion } from "./growth-storage.js";
import { cleanArticleOutput } from "./article-cleanup.js";

const router = express.Router();

router.post("/cleanup-citations", async (req, res) => {
  const summaries = await listDrafts();
  let updated = 0;
  let skipped = 0;

  for (const summary of summaries) {
    const draft = await getDraft(summary.id);
    if (!draft?.article) {
      skipped += 1;
      continue;
    }
    const cleaned = cleanArticleOutput(draft.article);
    const before = JSON.stringify({
      body_html: draft.article.body_html,
      meta_description: draft.article.meta_description,
      excerpt: draft.article.excerpt,
      sources: draft.article.sources
    });
    const after = JSON.stringify({
      body_html: cleaned.body_html,
      meta_description: cleaned.meta_description,
      excerpt: cleaned.excerpt,
      sources: cleaned.sources
    });
    if (before === after) {
      skipped += 1;
      continue;
    }
    await snapshotDraftVersion(draft, "before-citation-cleanup");
    await saveDraft({ ...draft, article: cleaned });
    updated += 1;
  }

  res.json({ ok: true, updated, skipped, total: summaries.length });
});

export function createCitationCleanupRouter() {
  return router;
}
