import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { PotionMark } from "@/components/potion-mark";
import { APP_VERSION_LABEL } from "@/lib/version";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "up") {
        const { error } = await authClient.signUp.email({
          email,
          password,
          name: email.split("@")[0] || "Potion",
          callbackURL: "/",
        });
        if (error) throw new Error(error.message || "Could not create account");
      } else {
        const { error } = await authClient.signIn.email({
          email,
          password,
          callbackURL: "/",
        });
        if (error) throw new Error(error.message || "Could not sign in");
      }
      window.location.assign("/");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-8 text-foreground">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6">
        <PotionMark className="size-12" />
        <div>
          <h1 className="font-serif text-3xl italic">Optional</h1>
          <p className="mt-1 text-[11px] text-muted">{APP_VERSION_LABEL}</p>
          <p className="mt-2 text-sm text-muted">
            Potion works with no account. Sign in only if you want the same folder on another phone or
            computer.
          </p>
        </div>
        {authEnabled ? (
          <>
            <div className="flex flex-col gap-2">
              {GROK_PROVIDERS.map((p) => (
                <button
                  key={p.providerId}
                  type="button"
                  onClick={() => signIn(p.providerId, { callbackURL: "/" })}
                  className="h-11 w-full rounded-full border border-border bg-elevated text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                >
                  Continue with {p.label}
                </button>
              ))}
            </div>
            <p className="text-center text-xs tracking-widest text-muted uppercase">or email</p>
            <form className="space-y-3" onSubmit={(e) => void onEmail(e)}>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="username"
                className="h-11 w-full rounded-lg border border-border bg-background px-3"
              />
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (8+ letters)"
                autoComplete={mode === "up" ? "new-password" : "current-password"}
                className="h-11 w-full rounded-lg border border-border bg-background px-3"
              />
              <button
                type="submit"
                disabled={busy}
                className="h-11 w-full rounded-full bg-accent text-sm font-medium text-accent-foreground disabled:opacity-60"
              >
                {busy ? "Working" : mode === "up" ? "Create account" : "Sign in"}
              </button>
              {err ? <p className="text-sm text-destructive">{err}</p> : null}
            </form>
            <button
              type="button"
              className="w-full text-sm text-muted"
              onClick={() => setMode(mode === "up" ? "in" : "up")}
            >
              {mode === "up" ? "I already have an account" : "Create an account with email"}
            </button>
          </>
        ) : (
          <p className="text-sm text-muted">Sign-in is off. Use the folder as-is.</p>
        )}
        <Link
          to="/"
          className="flex h-11 items-center justify-center rounded-full border border-border text-sm text-muted"
        >
          Skip — stay on this device
        </Link>
      </div>
    </main>
  );
}
