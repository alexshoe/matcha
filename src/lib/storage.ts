import type { SupabaseClient } from "@supabase/supabase-js";

const IMAGE_BUCKET = "images";
const FILE_BUCKET = "files";
const IMAGE_PATH_MARKER = `/storage/v1/object/public/${IMAGE_BUCKET}/`;
const FILE_PATH_MARKER = `/storage/v1/object/public/${FILE_BUCKET}/`;

function imageExtFromFile(file: File): string {
  const mime = file.type.split("/")[1];
  if (mime === "jpeg") return "jpg";
  return mime || "png";
}

export async function uploadNoteImage(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
  file: File,
): Promise<string | null> {
  const ext = imageExtFromFile(file);
  const path = `${userId}/${noteId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    console.warn("Image upload failed:", error.message);
    return null;
  }

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  const url = data.publicUrl;

  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) {
      console.warn("Uploaded image not publicly accessible, cleaning up:", res.status);
      await supabase.storage.from(IMAGE_BUCKET).remove([path]);
      return null;
    }
  } catch {
    console.warn("Could not verify uploaded image URL, cleaning up");
    await supabase.storage.from(IMAGE_BUCKET).remove([path]);
    return null;
  }

  return url;
}

function imagePathFromUrl(url: string): string | null {
  const idx = url.indexOf(IMAGE_PATH_MARKER);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + IMAGE_PATH_MARKER.length));
}

function filePathFromUrl(url: string): string | null {
  const idx = url.indexOf(FILE_PATH_MARKER);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + FILE_PATH_MARKER.length));
}

export async function deleteNoteImages(
  supabase: SupabaseClient,
  urls: string[],
): Promise<void> {
  const paths = urls
    .map(imagePathFromUrl)
    .filter((p): p is string => p !== null);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).remove(paths);
  if (error) console.warn("Image delete failed:", error.message);
}

export async function deleteAllNoteImages(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
): Promise<void> {
  const { data, error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .list(`${userId}/${noteId}`);

  if (error || !data || data.length === 0) return;
  const paths = data.map((f) => `${userId}/${noteId}/${f.name}`);
  await supabase.storage.from(IMAGE_BUCKET).remove(paths);
}

export function isImageStorageUrl(url: string): boolean {
  return url.includes(IMAGE_PATH_MARKER);
}

export function isFileStorageUrl(url: string): boolean {
  return url.includes(FILE_PATH_MARKER);
}

// ── File (PDF) attachment helpers ─────────────────────────

export async function uploadNoteFile(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
  file: File,
): Promise<string | null> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${noteId}/${crypto.randomUUID()}_${safeName}`;

  const { error } = await supabase.storage
    .from(FILE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    console.warn("File upload failed:", error.message);
    return null;
  }

  const { data } = supabase.storage.from(FILE_BUCKET).getPublicUrl(path);
  const url = data.publicUrl;

  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) {
      console.warn("Uploaded file not publicly accessible, cleaning up:", res.status);
      await supabase.storage.from(FILE_BUCKET).remove([path]);
      return null;
    }
  } catch {
    console.warn("Could not verify uploaded file URL, cleaning up");
    await supabase.storage.from(FILE_BUCKET).remove([path]);
    return null;
  }

  return url;
}

export async function deleteNoteFiles(
  supabase: SupabaseClient,
  urls: string[],
): Promise<void> {
  const paths = urls
    .map(filePathFromUrl)
    .filter((p): p is string => p !== null);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(FILE_BUCKET).remove(paths);
  if (error) console.warn("File delete failed:", error.message);
}

export async function deleteAllNoteFiles(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
): Promise<void> {
  const { data, error } = await supabase.storage
    .from(FILE_BUCKET)
    .list(`${userId}/${noteId}`);

  if (error || !data || data.length === 0) return;
  const paths = data.map((f) => `${userId}/${noteId}/${f.name}`);
  await supabase.storage.from(FILE_BUCKET).remove(paths);
}

// ── URL extraction from TipTap doc JSON ───────────────────

export function extractStorageUrls(content: string): { imageUrls: string[]; fileUrls: string[] } {
  if (!content) return { imageUrls: [], fileUrls: [] };
  try {
    const doc = JSON.parse(content);
    const imageUrls: string[] = [];
    const fileUrls: string[] = [];
    function walk(node: any) {
      if (node.type === "image" && node.attrs?.src && isImageStorageUrl(node.attrs.src)) {
        imageUrls.push(node.attrs.src);
      }
      if (node.type === "fileAttachment" && node.attrs?.src && isFileStorageUrl(node.attrs.src)) {
        fileUrls.push(node.attrs.src);
      }
      if (node.content) node.content.forEach(walk);
    }
    walk(doc);
    return { imageUrls, fileUrls };
  } catch {
    return { imageUrls: [], fileUrls: [] };
  }
}
