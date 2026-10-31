import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { Disclaimer } from "@/components/Disclaimer";
import { Banner, Field, inputCls, primaryBtn, secondaryBtn } from "../profile/ui";
import { mapAuthError, validateEmail, validatePassword } from "./authLogic";

type Mode = "signin" | "signup" | "reset";

export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [message, setMessage] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (m: Mode) => { setMode(m); setErrors({}); setMessage(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const emailErr = validateEmail(email);
    const passErr = mode === "reset" ? null : validatePassword(password);
    setErrors({ ...(emailErr ? { email: emailErr } : {}), ...(passErr ? { password: passErr } : {}) });
    if (emailErr || passErr) return;

    setBusy(true);
    try {
      const addr = email.trim();
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(addr, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setMessage({ kind: "success", text: "If an account exists for that email, a reset link is on its way." });
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: addr, password, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (data.session) navigate("/", { replace: true });
        else setMessage({ kind: "success", text: "Account created. Check your email for a confirmation link, then sign in." });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: addr, password });
        if (error) throw error;
        navigate("/", { replace: true });
      }
    } catch (err) {
      setMessage({ kind: "error", text: mapAuthError(err instanceof Error ? err.message : "") });
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setMessage(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (error) {
      setMessage({ kind: "error", text: mapAuthError(error.message) });
      setBusy(false);
    }
  };

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create your account" : "Reset your password";
  const disabled = busy || !isSupabaseConfigured;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center space-y-4 p-4">
      <header className="text-center">
        <h1 className="text-2xl font-bold text-teal-700 dark:text-teal-400">FitTrack</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
      </header>

      {!isSupabaseConfigured && (
        <Banner kind="warn">
          The app is not connected to a backend yet. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your <code>.env</code> file, then restart the dev server.
        </Banner>
      )}

      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field id="auth-email" label="Email" error={errors.email}>
          <input id="auth-email" type="email" autoComplete="email" className={inputCls} value={email} aria-invalid={!!errors.email} disabled={disabled} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {mode !== "reset" && (
          <Field id="auth-password" label="Password" hint={mode === "signup" ? "At least 8 characters" : undefined} error={errors.password}>
            <input id="auth-password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} className={inputCls} value={password} aria-invalid={!!errors.password} disabled={disabled} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        {message && <Banner kind={message.kind}>{message.text}</Banner>}
        <button type="submit" disabled={disabled} className={primaryBtn}>
          {busy ? "Please wait..." : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </button>
      </form>

      {mode !== "reset" && (
        <>
          <div className="flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-300 dark:bg-slate-700" />or<span className="h-px flex-1 bg-slate-300 dark:bg-slate-700" /></div>
          <button type="button" disabled={disabled} onClick={() => void google()} className={`${secondaryBtn} w-full`}>Continue with Google</button>
        </>
      )}

      <div className="flex flex-col items-center gap-1 text-sm">
        {mode === "signin" && (
          <>
            <button type="button" className="underline" onClick={() => switchMode("signup")}>New here? Create an account</button>
            <button type="button" className="underline" onClick={() => switchMode("reset")}>Forgot password?</button>
          </>
        )}
        {mode === "signup" && <button type="button" className="underline" onClick={() => switchMode("signin")}>Already have an account? Sign in</button>}
        {mode === "reset" && <button type="button" className="underline" onClick={() => switchMode("signin")}>Back to sign in</button>}
      </div>
      <Disclaimer />
    </main>
  );
}
