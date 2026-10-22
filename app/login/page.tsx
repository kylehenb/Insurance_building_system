"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Mail, Loader2, CheckCircle } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (signInError) {
        setError(signInError.message);
        setIsLoading(false);
        return;
      }

      setIsSent(true);
    } catch (err) {
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  if (isSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="w-full max-w-md space-y-8 rounded-lg border border-ink/10 bg-white p-8 shadow-sm">
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ink/5">
              <CheckCircle className="h-8 w-8 text-ink" />
            </div>
            <h2 className="mt-6 text-2xl font-semibold text-ink">
              Check your email
            </h2>
            <p className="mt-2 text-sm text-ink/70">
              We sent a magic link to <strong>{email}</strong>.<br />
              Click the link in the email to sign in.
            </p>
          </div>
          <div className="mt-8 text-center">
            <button
              onClick={() => {
                setIsSent(false);
                setEmail("");
                setIsLoading(false);
              }}
              className="text-sm text-ink/60 hover:text-ink underline"
            >
              Send to a different email
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-md space-y-8 rounded-lg border border-ink/10 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ink">
            <Mail className="h-8 w-8 text-cream" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold text-ink">
            IRC Master
          </h1>
          <p className="mt-2 text-sm text-ink/70">
            Enter your email to receive a magic link
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-ink"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="mt-2 block w-full rounded-md border border-ink/20 bg-white px-4 py-3 text-ink placeholder:text-ink/40 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={isLoading || !email}
            className="w-full bg-ink text-cream hover:bg-ink/90 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              "Send magic link"
            )}
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-ink/50">
          By signing in, you agree to the terms of service.
        </p>
      </div>
    </div>
  );
}
