import fs from "node:fs/promises";
import path from "node:path";
import { generatedImagePath } from "./storage.js";

function cleanBaseUrl(url) { return String(url || "").replace(/\/+$/, ""); }
function publicBaseUrl() { return cleanBaseUrl(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL); }
function cloudinaryConfigured() { return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET); }

function resolvedMode() {
  const requested = String(process.env.IMAGE_HOST_MODE || "").trim().toLowerCase();
  if ((requested === "cloudinary" || !requested) && cloudinaryConfigured()) return "cloudinary";
  if (publicBaseUrl()) return "public";
  if (requested === "cloudinary") return "cloudinary";
  return requested || "public";
}

// Render에서는 RENDER_EXTERNAL_URL이 자동 제공되므로 Cloudinary 설정이 없을 때
// 생성 이미지를 현재 웹서비스의 공개 /generated URL로 자동 전환한다.
if (!cloudinaryConfigured() && publicBaseUrl()) process.env.IMAGE_HOST_MODE = "public";

async function readGeneratedImage(image) {
  try {
    return await fs.readFile(generatedImagePath(image.filename));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("생성 이미지 파일을 찾지 못했습니다. 무료 서버 재배포 과정에서 이전 이미지가 삭제되었을 수 있으니 이 글의 이미지를 다시 생성해 주세요.");
    }
    throw error;
  }
}

async function uploadCloudinary(image, draftId) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !uploadPreset) throw new Error("Cloudinary 설정이 없습니다.");
  const buffer = await readGeneratedImage(image);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "image/webp" }), path.basename(image.filename));
  form.append("upload_preset", uploadPreset);
  form.append("folder", `blogger-ai/${draftId}`);
  form.append("context", `alt=${String(image.alt || "").replace(/[|=]/g, " ")}`);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok || !data.secure_url) throw new Error(data?.error?.message || "Cloudinary 이미지 업로드에 실패했습니다.");
  return data.secure_url;
}

function publicImageUrl(image) {
  const base = publicBaseUrl();
  if (!base) throw new Error("이미지 공개 주소를 만들 수 없습니다. PUBLIC_BASE_URL 또는 Render 외부 주소가 필요합니다.");
  return `${base}/generated/${encodeURIComponent(image.filename)}`;
}

export function imageHostConfigured() {
  const mode = resolvedMode();
  if (mode === "cloudinary") return cloudinaryConfigured();
  if (mode === "public") return Boolean(publicBaseUrl());
  return false;
}

export async function hostImages(images, draftId) {
  const mode = resolvedMode();
  const hosted = [];
  for (const image of images) {
    if (image.hostedUrl) {
      hosted.push(image);
      continue;
    }
    let url;
    if (mode === "cloudinary") {
      try {
        url = await uploadCloudinary(image, draftId);
      } catch (error) {
        if (!publicBaseUrl()) throw error;
        url = publicImageUrl(image);
      }
    } else if (mode === "public") {
      await readGeneratedImage(image);
      url = publicImageUrl(image);
    } else {
      throw new Error("지원하지 않는 이미지 호스팅 방식입니다.");
    }
    hosted.push({ ...image, hostedUrl: url });
  }
  return hosted;
}
