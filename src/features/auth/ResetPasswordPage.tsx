import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { Spinner } from "@/components/States";
import { Banner, Field, inputCls, primaryBtn } from "../profile/ui";
import { mapAuthError, validatePassword } from "./authLogic";

/** Landing page for the password-reset email link: Supabase signs the user in, then they choose a new password. */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { user, loading } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Spinner />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = validatePassword(password) ?? (password !== confirm ? "The two passwords do not match." : null);
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) throw upErr;
      navigate("/", { replace: true });
    } catch (e2) {
      setError(mapAuthError(e2 instanceof Error ? e2.message : ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center space-y-4 p-4">
      <header className="text-center">
        <h1 className="text-2xl font-bold text-teal-700 dark:text-teal-400">FitTrack</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Choose a new password</p>
      </header>
      {!user ? (
        <Banner kind="warn">
          This reset link is invalid or has expired. <Link className="underline" to="/login">Request a new one</Link>.
        </Banner>
      ) : (
        <form onSubmit={submit} className="space-y-3" noValidate>
          <Field id="np" label="New password" hint="At least 8 characters">
            <input id="np" type="password" autoComplete="new-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field id="np2" label="Confirm new password">
            <input id="np2" type="password" autoComplete="new-password" className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <Banner kind="error">{error}</Banner>}
          <button type="submit" disabled={busy} className={primaryBtn}>{busy ? "Saving..." : "Save new password"}</button>
        </form>
      )}
    </main>
  );
}
