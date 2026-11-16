import { Loader2, Save } from "lucide-react";

import { cn } from "@/lib/utils";

type PanelSaveBarProps = {
  /** id do <form> a enviar. Permite o botão ficar fora do formulário. */
  formId?: string;
  /** Ação direta para páginas que salvam sem formulário. */
  onClick?: () => void;
  saving?: boolean;
  disabled?: boolean;
  label?: string;
  className?: string;
};

/**
 * Botão de salvar fixado no topo das telas do painel.
 *
 * Fica "sticky" no topo da área de rolagem, então a vendedora consegue salvar
 * a qualquer momento, sem precisar rolar até o fim do formulário.
 */
export function PanelSaveBar({
  formId,
  onClick,
  saving,
  disabled,
  label = "Salvar",
  className,
}: PanelSaveBarProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-30 -mx-5 mb-4 flex items-center justify-end border-b border-border/60 bg-background/95 px-5 py-2 backdrop-blur",
        className,
      )}
    >
      <button
        type={onClick ? "button" : "submit"}
        form={onClick ? undefined : formId}
        onClick={onClick}
        disabled={saving || disabled}
        className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-md shadow-primary/25 transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        {label}
      </button>
    </div>
  );
}
