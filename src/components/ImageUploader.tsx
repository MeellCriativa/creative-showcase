import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { uploadImage } from "@/lib/catalog";
import { cn } from "@/lib/utils";

type Props = {
  userId: string;
  value: string[];
  onChange: (urls: string[]) => void;
  max?: number;
  label?: string;
  shape?: "square" | "wide" | "circle";
};

export function ImageUploader({
  userId,
  value,
  onChange,
  max = 5,
  label = "Adicionar foto",
  shape = "square",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const remaining = max - value.length;
      const list = Array.from(files).slice(0, Math.max(remaining, 0));
      const urls: string[] = [];
      for (const file of list) urls.push(await uploadImage(file, userId));
      onChange([...value, ...urls]);
    } catch {
      toast.error("Não foi possível enviar a imagem.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const box = shape === "circle" ? "size-20 rounded-full" : shape === "wide" ? "h-24 w-full rounded-2xl" : "size-24 rounded-2xl";

  return (
    <div className="flex flex-wrap gap-3">
      {value.map((url) => (
        <div key={url} className={cn("relative overflow-hidden border border-border", box)}>
          <img src={url} alt="Imagem enviada" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(value.filter((u) => u !== url))}
            className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-foreground/70 text-background"
            aria-label="Remover imagem"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}

      {value.length < max && (
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "grid place-items-center gap-1 border border-dashed border-border bg-muted/60 text-[11px] font-medium text-muted-foreground",
            box,
          )}
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
          <span className="px-1 text-center leading-tight">{label}</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={max > 1}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
