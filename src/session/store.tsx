"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { revokeDownloads } from "@/lib/download";
import { emptySession, isEmptySession, SessionError, viewOf, type SessionState, type SessionView } from "./engine";

export type RunResult = { ok: true } | { ok: false; error: SessionError };

interface SessionContextValue {
  state: SessionState;
  view: SessionView;
  /** Applies one change to the session. A refusal is returned, not thrown, so the screen can show it. */
  run: (change: (state: SessionState) => SessionState) => RunResult;
  /** Drops everything this tab holds: files, mappings, decisions, the confirmation and prepared downloads. */
  clear: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Holds the session in React state and nowhere else. It is created empty when the page
 * loads, so a refresh or a new tab starts over, and it is never written to browser storage.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(emptySession);
  const latest = useRef(state);

  const run = useCallback((change: (current: SessionState) => SessionState): RunResult => {
    try {
      const next = change(latest.current);
      latest.current = next;
      setState(next);
      return { ok: true };
    } catch (error) {
      if (error instanceof SessionError) return { ok: false, error };
      throw error;
    }
  }, []);

  const clear = useCallback(() => {
    revokeDownloads();
    const next = emptySession();
    latest.current = next;
    setState(next);
  }, []);

  const hasWork = !isEmptySession(state);
  useEffect(() => {
    if (!hasWork) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasWork]);

  const value = useMemo(() => ({ state, view: viewOf(state), run, clear }), [state, run, clear]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
