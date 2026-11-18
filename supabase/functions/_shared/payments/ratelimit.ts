/**
 * Proteção contra abuso nas ações públicas de pagamento (auditoria A6).
 *
 * Janela fixa por bucket persistida em `payment_rate_limits` via RPC atômica
 * (`bump_payment_rate_limit`): dois isolates concorrentes não conseguem passar
 * do limite, porque o incremento acontece no banco.
 *
 * Falha de banco NÃO derruba o checkout: o limitador é fail-open e apenas
 * registra o erro — bloquear compra legítima por causa do limitador seria pior
 * do que não limitar.
 */
import { adminClient } from "./db.ts";

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterMs: number;
  hits: number;
};

export async function enforceRateLimit(input: {
  bucket: string;
  windowMs: number;
  max: number;
}): Promise<RateLimitDecision> {
  if (input.max <= 0) return { allowed: true, retryAfterMs: 0, hits: 0 };
  try {
    const admin = adminClient();
    const { data, error } = await admin.rpc("bump_payment_rate_limit", {
      p_bucket: input.bucket.slice(0, 200),
      p_window_ms: input.windowMs,
      p_max: input.max,
    });
    if (error) {
      console.error("[payments] rate limit indisponível", error.message);
      return { allowed: true, retryAfterMs: 0, hits: 0 };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed?: boolean; retry_after_ms?: number; hits?: number }
      | null;
    return {
      allowed: row?.allowed !== false,
      retryAfterMs: Number(row?.retry_after_ms ?? 0),
      hits: Number(row?.hits ?? 0),
    };
  } catch (error) {
    console.error("[payments] rate limit falhou", (error as Error).message);
    return { allowed: true, retryAfterMs: 0, hits: 0 };
  }
}

/** Identifica o cliente para o bucket (Cloudflare → proxy → fallback). */
export function clientFingerprint(req: Request): string {
  const headers = req.headers;
  const ip =
    headers.get("cf-connecting-ip") ??
    headers.get("x-real-ip") ??
    (headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ??
    "";
  return ip || "unknown";
}
