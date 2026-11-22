/**
 * Copia texto para a área de transferência com fallback.
 *
 * `navigator.clipboard.writeText` pode ser negado pelo navegador (permissão
 * `clipboard-write` = denied, contexto sem foco, iframe etc.). Nesse caso o
 * caminho antigo — textarea + `document.execCommand("copy")` — continua
 * funcionando e evita que o botão "Copiar" falhe silenciosamente.
 */
export async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* cai para o fallback abaixo */
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
