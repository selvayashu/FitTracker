import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface SessionState { session: Session | null; user: User | null; loading: boolean }
const Ctx = createContext<SessionState>({ session: null, user: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, user: null, loading: true });

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ session: data.session, user: data.session?.user ?? null, loading: false });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setState({ session, user: session?.user ?? null, loading: false });
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
