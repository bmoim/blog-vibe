import fs from "node:fs/promises";
import path from "node:path";
import { generatedImagePath } from "./storage.js";

function cleanBaseUrl(url) { return String(url || "").replace(/\/+$/, ""); }
async function uploadCloudinary(image, draftId) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME; const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !uploadPreset) throw new Error("Cloudinary cloud name 또는 unsigned upload preset이 설정되지 않았습니다.");
  const buffer = await fs.readFile(generatedImagePath(image.filename));
  const form = new FormData(); form.append("file", new Blob([buffer], { type: "image/webp" }), path.basename(image.filename));
  form.append("upload_preset", uploadPreset); form.append("folder", `blogger-ai/${draftId}`); form.append("context", `alt=${String(image.alt || "").replace(/[|=]/g, " ")}`);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: form });
  const data = await response.json(); if (!response.ok || !data.secure_url) throw new Error(data?.error?.message || "Cloudinary 이미지 업로드에 실패했습니다.");
  return data.secure_url;
}
export function imageHostConfigured() {
  const mode = process.env.IMAGE_HOST_MODE || "cloudinary";
  if (mode === "cloudinary") return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET);
  if (mode === "public") return Boolean(process.env.PUBLIC_BASE_URL);
  return false;
}
export async function hostImages(images, draftId) {
  const mode = process.env.IMAGE_HOST_MODE || "cloudinary"; const hosted = [];
  for (const image of images) {
    let url;
    if (mode === "cloudinary") url = await uploadCloudinary(image, draftId);
    else if (mode === "public") { const base = cleanBaseUrl(process.env.PUBLIC_BASE_URL); if (!base) throw new Error("PUBLIC_BASE_URL이 설정되지 않았습니다."); url = `${base}/generated/${encodeURIComponent(image.filename)}`; }
    else throw new Error("IMAGE_HOST_MODE는 cloudinary 또는 public이어야 합니다.");
    hosted.push({ ...image, hostedUrl: url });
  }
  return hosted;
}
