import { useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '../api/errors';
import { useAuth } from '../auth/AuthProvider';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { ErrorState } from '../components/ui/Feedback';
import { useMe, useUpdateMe } from '../hooks/useServerState';
import { presentApiError } from '../lib/auditCopy';

export function SettingsPage() {
  const { session } = useAuth();
  const me = useMe(Boolean(session));
  const update = useUpdateMe();
  const toast = useToast();
  const [name, setName] = useState('');

  useEffect(() => {
    if (me.data) {
      setName(me.data.user.display_name ?? '');
    }
  }, [me.data]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length > 100) {
      return;
    }
    try {
      await update.mutateAsync(trimmed.length === 0 ? null : trimmed);
      toast('Display name saved.');
    } catch (error) {
      toast(error instanceof ApiError ? presentApiError(error) : 'Something went wrong. Try again.');
    }
  }

  if (me.isLoading) {
    return <p role="status">Loading settings…</p>;
  }
  if (me.isError) {
    return <ErrorState message="Could not load your profile." onRetry={() => void me.refetch()} />;
  }

  return (
    <section className="stack">
      <div>
        <p className="kicker">Account</p>
        <h1>Settings</h1>
      </div>
      <form className="panel stack" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Email</span>
          <input value={me.data?.user.email ?? ''} readOnly />
        </label>
        <label className="field">
          <span>Display name</span>
          <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className="help">Leave this blank to clear the name. It can be up to 100 characters.</p>
        <div>
          <Button type="submit" pending={update.isPending}>Save</Button>
        </div>
      </form>
    </section>
  );
}
