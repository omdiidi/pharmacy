'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MailCheck, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authorized':
    'Your email is not authorized for this app. Contact Dev or Nick.',
  'callback-failed': 'Sign-in callback failed. Please try the magic link again.',
  'missing-code': 'Magic-link callback was missing the verification code. Request a new link below.',
  'exchange-failed': 'Could not verify the magic link (it may have expired or already been used). Request a new one below.',
  expired: 'That magic link has expired. Request a new one below.',
};

const IS_DEV =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_DEV_LOGIN_ENABLED === 'true';

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInPageInner />
    </Suspense>
  );
}

function SignInPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorKey = searchParams?.get('error') ?? null;
  const errorBanner = errorKey ? ERROR_MESSAGES[errorKey] ?? 'Sign-in failed.' : null;

  const [email, setEmail] = useState(IS_DEV ? 'zomid777@gmail.com' : '');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [devPassword, setDevPassword] = useState('000000');
  const [devSubmitting, setDevSubmitting] = useState(false);
  const [devError, setDevError] = useState<string | null>(null);

  async function onSubmitMagicLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const supabase = createClient();
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL ??
        (typeof window !== 'undefined' ? window.location.origin : '');
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${siteUrl}/api/auth/callback` },
      });
      if (error) {
        setFormError(error.message);
      } else {
        setSent(true);
      }
    } catch (err) {
      setFormError((err as Error).message ?? 'Failed to send magic link.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDevLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDevError(null);
    setDevSubmitting(true);

    try {
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password: devPassword }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setDevError(body.error ?? `Dev login failed (${res.status})`);
        return;
      }
      router.push('/');
      router.refresh();
    } catch (err) {
      setDevError((err as Error).message ?? 'Dev login failed.');
    } finally {
      setDevSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">Sign in to PharmaDash</CardTitle>
          <CardDescription>
            We&apos;ll email you a one-time link. No password needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorBanner ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorBanner}
            </div>
          ) : null}

          {sent ? (
            <div className="flex items-start gap-3 rounded-md border bg-secondary/50 px-3 py-3 text-sm">
              <MailCheck className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">Check your email</div>
                <div className="text-muted-foreground">
                  We sent a link to <span className="font-mono">{email}</span>.
                </div>
                {IS_DEV ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Local dev: emails go to{' '}
                    <a
                      href="http://localhost:54324"
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-primary"
                    >
                      localhost:54324
                    </a>
                    , not real inbox.
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmitMagicLink} className="space-y-3">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                disabled={submitting || devSubmitting}
              />
              {formError ? (
                <p className="text-xs text-destructive">{formError}</p>
              ) : null}
              <Button
                type="submit"
                disabled={submitting || devSubmitting || !email.trim()}
                className="w-full"
              >
                {submitting ? 'Sending…' : 'Send magic link'}
              </Button>
            </form>
          )}

          {IS_DEV && !sent ? (
            <>
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Dev only</span>
                </div>
              </div>
              <form onSubmit={onDevLogin} className="space-y-3">
                <Input
                  type="text"
                  value={devPassword}
                  onChange={(e) => setDevPassword(e.target.value)}
                  placeholder="Dev password (default 0000)"
                  disabled={devSubmitting || submitting}
                />
                {devError ? (
                  <p className="text-xs text-destructive">{devError}</p>
                ) : null}
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={devSubmitting || submitting || !email.trim()}
                  className="w-full"
                >
                  <Zap className="h-4 w-4 mr-2" />
                  {devSubmitting ? 'Signing in…' : 'Quick dev sign-in'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Skips magic link. Disabled in production. Bypassed by setting{' '}
                  <span className="font-mono">DEV_PASSWORD</span> in .env.
                </p>
              </form>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
