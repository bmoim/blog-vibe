import express from "express";
import { google } from "googleapis";
import {
  readGoogleToken,
  saveGoogleToken,
  readGoogleOAuthConfig
} from "./storage.js";
import { getGoogleRedirectUri } from "./blogger-service.js";

const router = express.Router();

async function googleAuthClient() {
  const stored = await readGoogleOAuthConfig();
  const clientId = stored?.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = stored?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const token = await readGoogleToken();
  if (!clientId || !clientSecret) throw new Error("Google OAuth 설정이 필요합니다.");
  if (!token) throw new Error("Google 계정을 다시 연결해 주세요.");
  const client = new google.auth.OAuth2(clientId, clientSecret, getGoogleRedirectUri());
  client.setCredentials(token);
  client.on("tokens", async (tokens) => saveGoogleToken({ ...token, ...tokens }));
  return client;
}

async function discoverSearchConsole(auth) {
  const api = google.searchconsole({ version: "v1", auth });
  const response = await api.sites.list();
  return (response.data.siteEntry || []).map((site) => ({
    id: site.siteUrl,
    name: site.siteUrl,
    permission: site.permissionLevel
  }));
}

async function discoverGa4(auth) {
  const api = google.analyticsadmin({ version: "v1beta", auth });
  const response = await api.accountSummaries.list({ pageSize: 200 });
  const properties = [];
  for (const account of response.data.accountSummaries || []) {
    for (const property of account.propertySummaries || []) {
      properties.push({
        id: String(property.property || "").replace(/^properties\//, ""),
        name: property.displayName || property.property,
        accountName: account.displayName || account.account
      });
    }
  }
  return properties;
}

async function discoverAdsense(auth) {
  const api = google.adsense({ version: "v2", auth });
  const response = await api.accounts.list({ pageSize: 100 });
  return (response.data.accounts || []).map((account) => ({
    id: account.name,
    name: account.displayName || account.name,
    state: account.state || ""
  }));
}

router.get("/connections/discover", async (req, res) => {
  const auth = await googleAuthClient();
  const results = await Promise.allSettled([
    discoverSearchConsole(auth),
    discoverGa4(auth),
    discoverAdsense(auth)
  ]);
  const normalize = (result) => result.status === "fulfilled"
    ? { items: result.value, error: null }
    : { items: [], error: result.reason?.response?.data?.error?.message || result.reason?.message || "조회 실패" };
  res.json({
    searchConsole: normalize(results[0]),
    ga4: normalize(results[1]),
    adsense: normalize(results[2])
  });
});

export function createConnectionDiscoveryRouter() {
  return router;
}
