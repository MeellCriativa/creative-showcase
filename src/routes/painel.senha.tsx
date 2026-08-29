import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Eye, EyeOff, KeyboardIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/painel/senha")({
  head: () => ({
    meta: [
      { title: "Redefinir senha — Vitrine Criativa" },
      { name: "description", content: "Altere a senha do seu acesso ao painel da loja." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SenhaPage,
});

function SenhaPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    if (newPassword.length < 6) {
      toast.error("A nova senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não coincidem.");
      return;
    }
    setBusy(true);
    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) throw new Error("Senha atual incorreta.");

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      toast.success("Senha atualizada com sucesso!");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar senha.");
    } finally {
      setBusy(false);
    }
  }

  const toggle = () => setShow((s) => !s);

  return (
    <div className="px-5 pb-10 pt-10">
      <header className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-foreground">
          <KeyboardIcon className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Redefinir senha</h1>
          <p className="text-xs text-muted-foreground">Altere a senha do seu acesso</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="current" className="text-sm font-medium text-foreground">
            Senha atual
          </label>
          <div className="relative mt-1.5">
            <input
              id="current"
              type={show ? "text" : "password"}
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-2xl border border-input bg-card px-4 py-3.5 pr-12 text-base outline-none focus:border-primary"
              placeholder="Sua senha atual"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={toggle}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"
              aria-label={show ? "Ocultar senhas" : "Mostrar senhas"}
            >
              {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="new" className="text-sm font-medium text-foreground">
            Nova senha
          </label>
          <input
            id="new"
            type={show ? "text" : "password"}
            required
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="mt-1.5 w-full rounded-2xl border border-input bg-card px-4 py-3.5 text-base outline-none focus:border-primary"
            placeholder="mínimo 6 caracteres"
          />
        </div>

        <div>
          <label htmlFor="confirm" className="text-sm font-medium text-foreground">
            Confirmar nova senha
          </label>
          <input
            id="confirm"
            type={show ? "text" : "password"}
            required
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="mt-1.5 w-full rounded-2xl border border-input bg-card px-4 py-3.5 text-base outline-none focus:border-primary"
            placeholder="Repita a nova senha"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Salvar nova senha
        </button>
      </form>
    </div>
  );
}