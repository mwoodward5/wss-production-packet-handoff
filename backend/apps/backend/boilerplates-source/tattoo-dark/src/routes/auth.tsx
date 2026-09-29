import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { siteConfig } from "@/config/siteConfig";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/admin" },
        });
        if (error) throw error;
        toast.success("Account created. Signing you in…");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/admin" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wss min-h-screen bg-ink text-bone flex items-center justify-center px-4">
      <div className="glass w-full max-w-md p-8">
        <Link to="/" className="text-xs text-fadetext hover:text-bone">← back to site</Link>
        <h1 className="mt-4 text-3xl font-bold font-display">
          {siteConfig.studioName}
        </h1>
        <p className="text-fadetext text-sm mt-1">Studio dashboard access</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field"
          />
          <button
            disabled={loading}
            className="w-full bg-signal text-ink font-semibold py-3 rounded-full emboss disabled:opacity-60"
          >
            {loading ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
        <button
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          className="mt-4 text-xs text-fadetext hover:text-bone w-full text-center"
        >
          {mode === "signup" ? "Have an account? Sign in" : "Need an account? Sign up"}
        </button>
        <p className="mt-6 text-[11px] text-fadetext leading-relaxed">
          The first account to sign up and claim admin becomes the studio owner.
        </p>
      </div>
    </div>
  );
}
