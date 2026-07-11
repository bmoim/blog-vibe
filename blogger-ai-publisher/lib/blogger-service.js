import crypto from "node:crypto";
import { google } from "googleapis";
import { readGoogleToken, saveGoogleToken, removeGoogleToken, readGoogleOAuthConfig, saveGoogleOAuthConfig, removeGoogleOAuthConfig } from "./storage.js";

const SCOPES = ["https://www.googleapis.com/auth/blogger"];
function cleanBaseUrl(value) { return String(value || "").replace(/\/+$/, ""); }
export function getGoogleRedirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const deployedBase = cleanBaseUrl(process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL);
  return deployedBase ? `${deployedBase}/auth/google/callback` : "http://localhost:3000/auth/google/callback";
}

async function getGoogleConfig() {
  const stored = await readGoogleOAuthConfig();
  if (stored?.clientId && stored?.clientSecret) return { ...stored, source: "uploaded" };
  const envId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const envSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  if (envId && envSecret && !envSecret.includes("*")) return { clientId: envId, clientSecret: envSecret, source: "environment" };
  return null;
}

export async function isGoogleConfigured() { return Boolean(await getGoogleConfig()); }
export async function getGoogleConfigStatus() {
  const config = await getGoogleConfig();
  return config ? {
    configured: true,
    source: config.source,
    clientIdHint: `${config.clientId.slice(0, 16)}…${config.clientId.slice(-24)}`,
    redirectUri: getGoogleRedirectUri()
  } : { configured: false, source: null, clientIdHint: null, redirectUri: getGoogleRedirectUri() };
}

export async function saveGoogleConfigFromJson(input) {
  let parsed;
  try { parsed = typeof input === "string" ? JSON.parse(input) : input; }
  catch { throw new Error("Google OAuth JSON 파일 형식이 올바르지 않습니다."); }
  const web = parsed?.web || parsed?.installed || parsed;
  const clientId = String(web?.client_id || web?.clientId || "").trim();
  const clientSecret = String(web?.client_secret || web?.clientSecret || "").trim();
  if (!clientId || !clientSecret) throw new Error("JSON 파일에서 client_id와 client_secret을 찾지 못했습니다.");
  if (!clientId.endsWith(".apps.googleusercontent.com")) throw new Error("올바른 Google OAuth 클라이언트 ID가 아닙니다.");
  if (clientSecret.includes("*") || clientSecret.length < 8) throw new Error("가려진 비밀번호가 아니라 JSON 파일에 들어 있는 전체 client_secret이 필요합니다.");
  await saveGoogleOAuthConfig({ clientId, clientSecret, savedAt: new Date().toISOString() });
  await removeGoogleToken();
  return { configured: true, source: "uploaded", clientIdHint: `${clientId.slice(0, 16)}…${clientId.slice(-24)}`, redirectUri: getGoogleRedirectUri() };
}

export async function clearGoogleConfig() { await removeGoogleToken(); await removeGoogleOAuthConfig(); }
async function createOAuthClient() {
  const config = await getGoogleConfig();
  if (!config) throw new Error("Google OAuth 설정이 없습니다. 프로그램에서 OAuth JSON 파일을 등록해 주세요.");
  return new google.auth.OAuth2(config.clientId, config.clientSecret, getGoogleRedirectUri());
}
async function authorizedClient() {
  const token = await readGoogleToken();
  if (!token) throw new Error("Google 계정 연결이 필요합니다.");
  const client = await createOAuthClient();
  client.setCredentials(token);
  client.on("tokens", async (newTokens) => saveGoogleToken({ ...token, ...newTokens }));
  return client;
}
export async function createGoogleAuthUrl(session) {
  const client = await createOAuthClient();
  const state = crypto.randomBytes(24).toString("hex");
  session.googleOAuthState = state;
  return client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state, include_granted_scopes: true });
}
export async function handleGoogleCallback(code, state, session) {
  if (!code) throw new Error("Google 인증 코드가 없습니다.");
  if (!state || state !== session.googleOAuthState) throw new Error("Google 로그인 상태값이 일치하지 않습니다. 다시 연결해 주세요.");
  delete session.googleOAuthState;
  const client = await createOAuthClient();
  try {
    const { tokens } = await client.getToken(code);
    await saveGoogleToken({ ...(await readGoogleToken()), ...tokens });
  } catch (error) {
    const message = error?.response?.data?.error || error?.message || "Google 토큰 발급 실패";
    if (String(message).includes("invalid_client")) throw new Error("Google 클라이언트 ID 또는 전체 client_secret이 맞지 않습니다. 앱의 'Google 설정 변경'에서 같은 JSON 파일을 다시 등록해 주세요.");
    throw error;
  }
}
export async function isGoogleConnected() { const token = await readGoogleToken(); return Boolean(token?.access_token || token?.refresh_token); }
export async function disconnectGoogle() {
  const token = await readGoogleToken();
  if (token) try { const client = await createOAuthClient(); client.setCredentials(token); if (token.access_token) await client.revokeToken(token.access_token); } catch {}
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
