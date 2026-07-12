export const TOPIC_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["plan_summary", "site_positioning", "monthly_strategy", "clusters", "topics"],
  properties: {
    plan_summary: { type: "string" },
    site_positioning: { type: "string" },
    monthly_strategy: { type: "string" },
    clusters: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "purpose", "share_percent", "pillar_page"],
        properties: {
          name: { type: "string" },
          purpose: { type: "string" },
          share_percent: { type: "integer", minimum: 0, maximum: 100 },
          pillar_page: { type: "string" }
        }
      }
    },
    topics: {
      type: "array",
      minItems: 10,
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "day", "priority", "title", "primary_keyword", "secondary_keywords", "search_intent", "content_type", "cluster", "reader_problem", "angle", "why_now", "authority_evidence", "official_sources_to_check", "monetization_path", "caution", "existing_gap", "estimated_effort", "scores"],
        properties: {
          id: { type: "string" },
          day: { type: "integer", minimum: 1, maximum: 60 },
          priority: { type: "string", enum: ["now", "next", "later"] },
          title: { type: "string" },
          primary_keyword: { type: "string" },
          secondary_keywords: { type: "array", maxItems: 6, items: { type: "string" } },
          search_intent: { type: "string", enum: ["problem-solving", "informational", "comparison", "commercial", "transactional", "timely-update"] },
          content_type: { type: "string", enum: ["evergreen", "update", "comparison", "checklist", "how-to", "case-study"] },
          cluster: { type: "string" },
          reader_problem: { type: "string" },
          angle: { type: "string" },
          why_now: { type: "string" },
          authority_evidence: { type: "string" },
          official_sources_to_check: { type: "array", maxItems: 6, items: { type: "string" } },
          monetization_path: { type: "string" },
          caution: { type: "string" },
          existing_gap: { type: "string" },
          estimated_effort: { type: "string", enum: ["low", "medium", "high"] },
          scores: {
            type: "object",
            additionalProperties: false,
            required: ["demand", "revenue_intent", "authority_fit", "competition_opportunity", "freshness", "overall"],
            properties: {
              demand: { type: "integer", minimum: 0, maximum: 100 },
              revenue_intent: { type: "integer", minimum: 0, maximum: 100 },
              authority_fit: { type: "integer", minimum: 0, maximum: 100 },
              competition_opportunity: { type: "integer", minimum: 0, maximum: 100 },
              freshness: { type: "integer", minimum: 0, maximum: 100 },
              overall: { type: "integer", minimum: 0, maximum: 100 }
            }
          }
        }
      }
    }
  }
};
