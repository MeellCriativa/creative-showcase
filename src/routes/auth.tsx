import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Vitrine Criativa" },
      { name: "description", content: "Acesse o painel da sua loja e gerencie seu catálogo digital." },
      { property: "og:title", content: "Entrar — Vitrine Criativa" },
      { property: "og:description", content: "Acesse o painel da sua loja no Vitrine Criativa." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate({ to: "/painel" });
  }, [loading, session, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Conta criada! Verifique seu e-mail para confirmar.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Login realizado!");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao entrar";
      toast.error(
        message.includes("Invalid login")
          ? "E-mail ou senha incorretos."
          : message.includes("already registered")
            ? "Este e-mail já tem conta. Faça login."
            : message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Não foi possível entrar com o Google.");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/painel" });
  }

  return (
    <main className="app-shell flex flex-col justify-center px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">
        {mode === "login" ? "Entrar" : "Criar conta"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {mode === "login"
          ? "Acesse o painel da sua vitrine."
          : "Comece a montar seu catálogo em minutos."}
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="email" className="text-sm font-medium text-foreground">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 w-full rounded-2xl border border-input bg-card px-4 py-3.5 text-base outline-none focus:border-primary"
            placeholder="voce@email.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="text-sm font-medium text-foreground">
            Senha
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-2xl border border-input bg-card px-4 py-3.5 text-base outline-none focus:border-primary"
            placeholder="mínimo 6 caracteres"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {mode === "login" ? "Entrar" : "Criar minha conta"}
        </button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        className="w-full rounded-2xl border border-border bg-card px-5 py-3.5 font-semibold text-foreground transition active:scale-[0.98]"
      >
        Continuar com Google
      </button>

      <button
        type="button"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="mt-8 text-center text-sm text-muted-foreground"
      >
        {mode === "login" ? (
          <>
            Ainda não tem conta? <span className="font-semibold text-primary">Criar conta</span>
          </>
        ) : (
          <>
            Já tem conta? <span className="font-semibold text-primary">Entrar</span>
          </>
        )}
      </button>
    </main>
  );
}
