import { google } from "googleapis";
import {
  listDrafts,
  readGoogleToken,
  saveGoogleToken,
  readGoogleOAuthConfig
} from "./storage.js";
import { getGrowthSettings } from "./growth-storage.js";
import { getGoogleRedirectUri } from "./blogger-service.js";

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function googleAuthClient() {
  const stored = await readGoogleOAuthConfig();
  const clientId = stored?.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = stored?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const token = await readGoogleToken();
  if (!clientId || !clientSecret || !token) return null;
  const client = new google.auth.OAuth2(clientId, clientSecret, getGoogleRedirectUri());
  client.setCredentials(token);
  client.on("tokens", async (tokens) => saveGoogleToken({ ...token, ...tokens }));
  return client;
}

async function loadSearchSignals(siteUrl) {
  if (!siteUrl) return [];
  try {
    const auth = await googleAuthClient();
    if (!auth) return [];
    const api = google.searchconsole({ version: "v1", auth });
    const response = await api.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: daysAgo(92),
        endDate: daysAgo(2),
        dimensions: ["query"],
        rowLimit: 500,
        dataState: "final"
      }
    });
    return (response.data.rows || []).map((row) => ({
      query: row.keys?.[0] || "",
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0),
      position: Number(row.position || 0)
    })).filter((item) => item.query).sort((a, b) => b.impressions - a.impressions).slice(0, 120);
  } catch {
    return [];
  }
}

export async function collectTopicSignals(useSearchConsole = true) {
  const settings = await getGrowthSettings();
  const [drafts, searchSignals] = await Promise.all([
    listDrafts(),
    useSearchConsole ? loadSearchSignals(settings.searchConsoleSite) : Promise.resolve([])
  ]);
  return {
    drafts: drafts.slice(0, 120).map((draft) => ({
      title: draft.title,
      seoScore: draft.seoScore,
      updatedAt: draft.updatedAt
    })),
    searchSignals
  };
}
