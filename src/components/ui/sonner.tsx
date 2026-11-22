import { Toaster as Sonner } from "sonner";

import { useI18n } from "@/i18n";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ style, ...props }: ToasterProps) => {
  const { t } = useI18n();
  return (
    <Sonner
      className="toaster group"
      style={
        {
          // O Sonner usa o lado "start" (esquerda em LTR) por padrão.
          "--toast-close-button-start": "auto",
          "--toast-close-button-end": "0",
          "--toast-close-button-transform": "translate(35%, -35%)",
          ...style,
        } as React.CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: t("common.close"),
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton: "text-muted-foreground hover:text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
