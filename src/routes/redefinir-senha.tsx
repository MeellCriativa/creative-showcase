import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/redefinir-senha")({
  head: () => ({
    meta: [
      { title: "Redefinir senha — Vitrine Criativa" },
      {
        name: "description",
        content: "Defina uma nova senha para acessar o painel da sua loja.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    let unsub: (() => void) | undefined;

    try {
      const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        if (event === "PASSWORD_RECOVERY" || session) {
          setSessionReady(true);
          setChecking(false);
        }
      });
      unsub = () => sub.subscription.unsubscribe();

      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (!active) return;
          setSessionReady(Boolean(data.session));
          setChecking(false);
        })
        .catch(() => {
          if (!active) return;
          setChecking(false);
        });
    } catch {
      setChecking(false);
    }

    return () => {
      active = false;
      unsub?.();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error(t("auth.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t("auth.resetMismatch"));
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success(t("auth.resetSuccess"));
      window.setTimeout(() => navigate({ to: "/painel" }), 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.resetEmailError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell flex flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">{t("auth.resetTitle")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("auth.resetSubtitle")}</p>

      {checking ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("auth.resetSubmitting")}
        </div>
      ) : !sessionReady ? (
        <div className="mt-8 space-y-4">
          <p className="text-sm text-destructive">{t("auth.resetInvalid")}</p>
          <Link
            to="/auth"
            className="inline-flex rounded-2xl bg-primary px-5 py-3 font-semibold text-primary-foreground"
          >
            {t("auth.backToLogin")}
          </Link>
        </div>
      ) : done ? (
        <div className="mt-8 space-y-4">
          <p className="text-sm text-green-600">{t("auth.resetSuccess")}</p>
          <Link
            to="/painel"
            className="inline-flex rounded-2xl bg-primary px-5 py-3 font-semibold text-primary-foreground"
          >
            {t("panel.dashboard.yourStore")}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="new-password" className="text-sm font-medium text-foreground">
              {t("auth.resetNewPassword")}
            </label>
            <div className="relative mt-1.5">
              <input
                id="new-password"
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-2xl border border-input bg-card px-4 py-3.5 pr-12 text-base outline-none focus:border-primary"
                placeholder={t("auth.passwordPlaceholder")}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
                aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
              >
                {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
              {t("auth.resetConfirmPassword")}
            </label>
            <input
              id="confirm-password"
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1.5 w-full rounded-2xl border border-input bg-card px-4 py-3.5 text-base outline-none focus:border-primary"
              placeholder={t("auth.passwordPlaceholder")}
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition active:scale-[0.98] disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? t("auth.resetSubmitting") : t("auth.resetSubmit")}
          </button>
        </form>
      )}
    </main>
  );
}
