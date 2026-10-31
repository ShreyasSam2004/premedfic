/**
 * Upload validation. The file's type is determined from its bytes, never from
 * the filename or browser-supplied MIME type alone.
 */
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, type AllowedMime } from "@/domain/evidence";

export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  const b = bytes;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  return null;
}

export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "upload").slice(0, 150);
}

const ACTIVE_PDF_CONTENT = /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction\s*<<[^>]*\/S\s*\/JavaScript)\b/;

export interface UploadValidation {
  ok: boolean;
  mime: AllowedMime | null;
  filename: string;
  errors: string[];
}

export function validateUpload(input: { filename: string; bytes: Uint8Array }): UploadValidation {
  const filename = safeFilename(input.filename);
  const errors: string[] = [];
  if (input.bytes.byteLength === 0) errors.push("File is empty");
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) errors.push(`File exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`);
  const ext = (filename.match(/\.[A-Za-z0-9]+$/)?.[0] ?? "").toLowerCase();
  const allowedExts = Object.values(ALLOWED_UPLOAD_TYPES).flatMap((t) => t.ext as readonly string[]);
  if (!allowedExts.includes(ext)) errors.push("Only PDF, JPEG, and PNG files are accepted");
  const mime = input.bytes.byteLength ? sniffMime(input.bytes) : null;
  if (input.bytes.byteLength && !mime) errors.push("File content is not a valid PDF, JPEG, or PNG");
  if (mime && allowedExts.includes(ext) && !(ALLOWED_UPLOAD_TYPES[mime].ext as readonly string[]).includes(ext)) {
    errors.push("File extension does not match the file's content");
  }
  if (mime === "application/pdf") {
    const head = Buffer.from(input.bytes).toString("latin1");
    if (ACTIVE_PDF_CONTENT.test(head)) errors.push("PDF contains active content (scripts or embedded files) and was rejected");
  }
  return { ok: errors.length === 0, mime: errors.length ? null : mime, filename, errors };
}
