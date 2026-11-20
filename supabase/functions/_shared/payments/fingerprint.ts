/**
 * Identificação do cliente para rate limit — função PURA, sem I/O.
 *
 * P8: o bucket não pode ser controlado pelo visitante.
 *   - `cf-connecting-ip` só é aceito quando `cf-ray` está presente (sinal de
 *     que a requisição passou pelo Cloudflare);
 *   - caso contrário, usa o ÚLTIMO valor de `x-forwarded-for`, adicionado
 *     pelo proxy — o primeiro é controlado pelo cliente;
 *   - nunca confia em `x-real-ip` sozinho.
 *
 * Este arquivo não importa `db.ts`, para poder ser testado em Node sem os
 * imports Deno (`https://esm.sh/...`) usados pelas Edge Functions.
 */

export function clientFingerprintFromHeaders(
  headers: Headers | Record<string, string>,
): string {
  const get = (name: string): string | null => {
    if (headers instanceof Headers) return headers.get(name);
    const key = name.toLowerCase();
    for (const [candidate, value] of Object.entries(headers)) {
      if (candidate.toLowerCase() === key) return value;
    }
    return null;
  };

  const cfRay = get("cf-ray");
  const cfIp = get("cf-connecting-ip");
  if (cfRay && cfIp) return String(cfIp).trim().slice(0, 64) || "unknown";

  const parts = String(get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts.at(-1) ?? "unknown").slice(0, 64);
}

export function clientFingerprint(req: Request): string {
  return clientFingerprintFromHeaders(req.headers);
}
