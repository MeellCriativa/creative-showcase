/**
 * Proteção contra abuso nas ações públicas de pagamento (auditoria A6).
 *
 * Janela fixa por bucket persistida em `payment_rate_limits` via RPC atômica
 * (`bump_payment_rate_limit`): dois isolates concorrentes não conseguem passar
 * do limite, porque o incremento acontece no banco.
 *
 * P8: leituras (methods/payment_status) continuam fail-open para não travar a
 * navegação do comprador. Ações que criam cobrança (create_order/create_payment)
 * e o caminho inválido do webhook falham fechado: se o limitador estiver
 * indisponível, a operação é recusada com 503 em vez de liberar volume ilimitado.
 */
import { adminClient } from "./db.ts";

/** Reexportado para os chamadores existentes; a implementação pura mora em
 * `fingerprint.ts`, que não depende de `db.ts` (import Deno) e é testável. */
export { clientFingerprint, clientFingerprintFromHeaders } from "./fingerprint.ts";

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterMs: number;
  hits: number;
  degraded?: boolean;
};

export async function enforceRateLimit(input: {
  bucket: string;
  windowMs: number;
  max: number;
  failClosed?: boolean;
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
      if (input.failClosed) {
        return { allowed: false, retryAfterMs: 30_000, hits: 0, degraded: true };
      }
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
    if (input.failClosed) {
      return { allowed: false, retryAfterMs: 30_000, hits: 0, degraded: true };
    }
    return { allowed: true, retryAfterMs: 0, hits: 0 };
  }
}
