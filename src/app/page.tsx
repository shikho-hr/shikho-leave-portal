"use client";

import { useAuth } from "@/lib/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LoginPage() {
  const { user, status, error, signInWithGoogle } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-indigo-600">
        <div className="animate-spin h-8 w-8 border-4 border-white border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center bg-indigo-600">
      {/* Decorative circles like Shikho brand */}
      <div className="absolute top-[-80px] left-[-80px] w-[300px] h-[300px] rounded-full bg-indigo-500 opacity-40" />
      <div className="absolute bottom-[-120px] right-[-60px] w-[400px] h-[400px] rounded-full bg-indigo-500 opacity-30" />

      <div className="relative bg-white rounded-3xl shadow-2xl p-10 max-w-sm w-full text-center">
        {/* Shikho bird — primary mark, on paper */}
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-20 h-14 mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/shikho-bird.png"
              alt="Shikho"
              className="w-full h-full object-contain"
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 font-display">
            Leave Portal
          </h1>
          <p className="text-gray-500 mt-2 text-sm">
            Sign in with your Shikho Google account
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-coral/10 border border-coral/20 text-coral rounded-xl text-sm font-medium">
            {error}
          </div>
        )}

        <button
          onClick={() => signInWithGoogle()}
          className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 rounded-2xl px-4 py-3.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:border-indigo-300 hover:shadow-lg transition-all"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Sign in with Google
        </button>

        <p className="text-xs text-gray-400 mt-6">
          Only registered employees can access the portal
        </p>
      </div>
    </div>
  );
}
