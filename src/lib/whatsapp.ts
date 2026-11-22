/** Helpers puros para links wa.me (sem dependência do cliente Supabase). */

export function onlyDigits(value: string): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** Normaliza para o padrão brasileiro usado pelo wa.me (55 + DDD + número). */
export function normalizeWhatsappNumber(phone: string): string {
  const digits = onlyDigits(phone);
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export function whatsappLink(phone: string, message: string): string {
  const withCountry = normalizeWhatsappNumber(phone);
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}
