"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/admin/sources");
    });
  }, [router]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMessage(error.message);
    router.replace("/admin/sources");
  }

  return (
    <main className="center-shell">
      <div className="brand-mark">HEY NOW</div>
      <h1>Internal login</h1>
      <p className="muted">Source Registry access is restricted to HeyNow admins.</p>
      <form className="login-card" onSubmit={submit}>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        <button className="button" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        {message ? <div className="error">{message}</div> : null}
      </form>
    </main>
  );
}
