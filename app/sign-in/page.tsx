'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { MailCheck } from 'lucide-react';

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
  expired: 'That magic link has expired. Request a new one below.',
};

export default function SignInPage() {
  const searchParams = useSearchParams();
  const errorKey = searchParams?.get('error') ?? null;
  const errorBanner = errorKey ? ERROR_MESSAGES[errorKey] ?? 'Sign-in failed.' : null;

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
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
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-3">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                disabled={submitting}
              />
              {formError ? (
                <p className="text-xs text-destructive">{formError}</p>
              ) : null}
              <Button type="submit" disabled={submitting || !email.trim()} className="w-full">
                {submitting ? 'Sending…' : 'Send magic link'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
