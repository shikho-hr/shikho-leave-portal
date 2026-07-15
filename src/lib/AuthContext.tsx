"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase-client";

export interface AppUser {
  email: string;
  name: string;
  role: string;
  employeeType: string;
  department: string;
  employeeId: string;
}

type Status = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  user: AppUser | null;
  status: Status;
  error: string;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  status: "loading",
  error: "",
  signInWithGoogle: async () => {},
  signOutUser: async () => {},
});

async function fetchProfile(): Promise<AppUser | null> {
  const res = await fetch("/api/auth/me");
  if (!res.ok) return null;
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setStatus("unauthenticated");
        return;
      }

      // Try the existing session cookie first.
      let profile = await fetchProfile();

      // Cookie may be missing/expired even though Firebase still has a
      // signed-in user (e.g. cookie cleared) — silently re-establish it.
      if (!profile) {
        try {
          const idToken = await firebaseUser.getIdToken();
          const res = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken }),
          });
          if (res.ok) profile = await fetchProfile();
        } catch {
          // fall through — profile stays null
        }
      }

      if (profile) {
        setUser(profile);
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus("unauthenticated");
      }
    });

    return unsubscribe;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();

      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await firebaseSignOut(auth);
        setUser(null);
        setStatus("unauthenticated");
        setError(data.error || "Sign-in failed. Please try again.");
        return;
      }

      const profile = await fetchProfile();
      setUser(profile);
      setStatus(profile ? "authenticated" : "unauthenticated");
    } catch (err) {
      console.error("Sign-in error:", err);
      setError("Sign-in was cancelled or failed. Please try again.");
      setStatus("unauthenticated");
    }
  }, []);

  const signOutUser = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    await firebaseSignOut(auth);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, status, error, signInWithGoogle, signOutUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
