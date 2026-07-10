import crypto from "node:crypto";
import { google } from "googleapis";
import { readGoogleToken, saveGoogleToken, removeGoogleToken } from "./storage.js";

const SCOPES = ["https://www.googleapis.com/auth/blogger"];
function assertGoogleConfig() { if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error("GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET이 설정되지 않았습니다."); }
function cleanBaseUrl(value) { return String(value || "").replace(/\/+$/, ""); }
export function getGoogleRedirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const deployedBase = cleanBaseUrl(process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL);
  return deployedBase ? `${deployedBase}/auth/google/callback` : "http://localhost:3000/auth/google/callback";
}
function createOAuthClient() { assertGoogleConfig(); return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, getGoogleRedirectUri()); }
async function authorizedClient() {
  const token = await readGoogleToken(); if (!token) throw new Error("Google 계정 연결이 필요합니다.");
  const client = createOAuthClient(); client.setCredentials(token);
  client.on("tokens", async (newTokens) => saveGoogleToken({ ...token, ...newTokens }));
  return client;
}
export function createGoogleAuthUrl(session) {
  const client = createOAuthClient(); const state = crypto.randomBytes(24).toString("hex"); session.googleOAuthState = state;
  return client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state, include_granted_scopes: true });
}
export async function handleGoogleCallback(code, state, session) {
  if (!code) throw new Error("Google 인증 코드가 없습니다.");
  if (!state || state !== session.googleOAuthState) throw new Error("Google 로그인 상태값이 일치하지 않습니다. 다시 연결해 주세요.");
  delete session.googleOAuthState; const client = createOAuthClient(); const { tokens } = await client.getToken(code);
  await saveGoogleToken({ ...(await readGoogleToken()), ...tokens });
}
export async function isGoogleConnected() { const token = await readGoogleToken(); return Boolean(token?.access_token || token?.refresh_token); }
export async function disconnectGoogle() {
  const token = await readGoogleToken();
  if (token) try { const client = createOAuthClient(); client.setCredentials(token); if (token.access_token) await client.revokeToken(token.access_token); } catch {}
  await removeGoogleToken();
}
export async function listBlogs() {
  const blogger = google.blogger({ version: "v3", auth: await authorizedClient() });
  const response = await blogger.blogs.listByUser({ userId: "self", fetchUserInfo: true });
  return (response.data.items || []).map((blog) => ({ id: blog.id, name: blog.name, url: blog.url, postsTotal: blog.posts?.totalItems || 0 }));
}
export async function publishPost({ blogId, title, content, labels, isDraft }) {
  const blogger = google.blogger({ version: "v3", auth: await authorizedClient() });
  const response = await blogger.posts.insert({ blogId, isDraft: Boolean(isDraft), requestBody: { kind: "blogger#post", title, content, labels } });
  return { id: response.data.id, title: response.data.title, url: response.data.url || null, status: response.data.status || (isDraft ? "DRAFT" : "LIVE") };
}
