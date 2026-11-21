import { supabase } from "@/integrations/supabase/client";
import type { DigitalDelivery, DigitalFileMeta } from "@/lib/catalog";

/**
 * Cliente da entrega digital (vendedor).
 *
 * O bucket é privado: o navegador faz upload com a sessão do vendedor e o
 * download do comprador acontece somente pela Edge Function, via token.
 */

export const DIGITAL_BUCKET = "digital-products";
export const MAX_DIGITAL_FILE_BYTES = 50 * 1024 * 1024;
const FUNCTIONS_URL = `${import.meta.env["VITE_SUPABASE_URL"]}/functions/v1`;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/mpeg",
  "audio/mp4",
]);
const ALLOWED_EXT = new Set([
  "pdf", "zip", "7z", "rar", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "txt", "csv", "png", "jpg", "jpeg", "webp", "gif", "mp4", "mp3", "m4a",
]);

/** Validação do navegador — o backend repete todas as checagens. */
export function validateDigitalFile(file: File): { valid: boolean; reason?: string } {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const mime = (file.type || "").toLowerCase().split(";")[0]!.trim();
  if (!ALLOWED_EXT.has(ext)) return { valid: false, reason: "EXTENSAO_NAO_PERMITIDA" };
  if (!ALLOWED_MIME.has(mime)) return { valid: false, reason: "MIME_NAO_PERMITIDO" };
  if (file.size <= 0) return { valid: false, reason: "TAMANHO_INVALIDO" };
  if (file.size > MAX_DIGITAL_FILE_BYTES) return { valid: false, reason: "ARQUIVO_GRANDE_DEMAIS" };
  return { valid: true };
}

export function formatFileSize(bytes: number | null | undefined): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function checksum(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadDigitalFile(input: {
  file: File;
  userId: string;
  catalogId: string;
  productId?: string | null;
}): Promise<DigitalFileMeta> {
  const check = validateDigitalFile(input.file);
  if (!check.valid) throw new Error(check.reason ?? "ARQUIVO_INVALIDO");
  const ext = input.file.name.split(".").pop()!.toLowerCase();
  const folder = input.productId ?? "novo";
  const path = `${input.userId}/${input.catalogId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(DIGITAL_BUCKET).upload(path, input.file, {
    cacheControl: "3600",
    upsert: false,
    contentType: input.file.type || "application/octet-stream",
  });
  if (error) throw error;
  return {
    path,
    name: input.file.name,
    mime: input.file.type || "application/octet-stream",
    size: input.file.size,
    checksum: await checksum(input.file),
  };
}

export async function removeDigitalFile(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await supabase.storage.from(DIGITAL_BUCKET).remove([path]);
}

async function callFunction<T>(
  action: string,
  options: { method?: "GET" | "POST"; query?: Record<string, string>; body?: Record<string, unknown> } = {},
): Promise<T & { success: boolean; error?: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const url = new URL(`${FUNCTIONS_URL}/digital-delivery`);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
      "Content-Type": "application/json",
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { ...(payload as T), success: Boolean((payload as { success?: boolean }).success), error: (payload as { error?: string }).error };
}

export async function listDigitalDeliveries(catalogId: string): Promise<DigitalDelivery[]> {
  const result = await callFunction<{ deliveries: DigitalDelivery[] }>("status", {
    query: { catalog_id: catalogId },
  });
  if (!result.success) throw new Error(result.error ?? "Falha ao consultar entregas.");
  return result.deliveries ?? [];
}

export type DeliveryAction = "retry" | "regenerate" | "revoke";

export async function runDeliveryAction(action: DeliveryAction, deliveryId: string) {
  return await callFunction(action, {
    method: "POST",
    body: { delivery_id: deliveryId },
  });
}
