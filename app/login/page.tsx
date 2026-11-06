"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get("error") === "inactive") {
      setErrorMessage(
        "Your account is currently inactive. Please contact your administrator."
      );
    }
  }, [searchParams]);

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setErrorMessage("");

    const { data: authData, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setLoading(false);
      setErrorMessage(error.message);
      return;
    }

    // Check if account status is true (active)
    if (authData?.user) {
      try {
        const { data: profile } = await supabase
          .from("customer_profiles")
          .select("*")
          .eq("user_id", authData.user.id)
          .maybeSingle();

        if (profile) {
          const isAdmin =
            profile.role === "admin" ||
            authData.user.email?.toLowerCase().trim() === "unethmi0@gmail.com" ||
            Boolean(authData.user.email?.toLowerCase().includes("admin"));

          if (!isAdmin) {
            // Check status / is_active: must be true
            const isInactive =
              profile.status === false ||
              profile.status === "false" ||
              profile.status === "inactive" ||
              profile.status === "disabled" ||
              profile.is_active === false ||
              profile.is_active === "false";

            if (isInactive) {
              await supabase.auth.signOut();
              setLoading(false);
              setErrorMessage(
                "Your account is inactive. Please contact your administrator to activate your account."
              );
              return;
            }
          }
        }
      } catch (err) {
        console.warn("Could not verify customer active status:", err);
      }
    }

    setLoading(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed] px-4 py-10">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-md space-y-5 rounded-2xl bg-white p-8 shadow-sm"
      >
        <div className="text-center">
          <p className="text-sm tracking-[0.25em] text-amber-700">
            INVI CARDS
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-gray-900">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Log in to manage your invitations.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900 placeholder:text-gray-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-gray-900 placeholder:text-gray-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700"
            placeholder="Your password"
          />
        </div>

        {errorMessage && (
          <p role="alert" className="text-sm text-red-600">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[#8c6b45] p-3 font-medium text-white hover:bg-[#745637] disabled:opacity-60"
        >
          {loading ? "Logging in..." : "Log in"}
        </button>

        <p className="text-center text-sm text-gray-600">
          Don't have an account?{" "}
          <Link
            className="font-medium text-amber-800 underline"
            href="/register"
          >
            Register
          </Link>
        </p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-[#f8f4ed]">
          <p className="text-sm text-gray-600">Loading login...</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
