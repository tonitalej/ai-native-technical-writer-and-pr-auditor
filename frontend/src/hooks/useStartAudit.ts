import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { startAudit } from '../api/audits';
import { ApiError } from '../api/errors';
import { presentApiError } from '../lib/auditCopy';

export function useStartAudit(prId: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [holdUntil, setHoldUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const mutation = useMutation({
    mutationFn: () => startAudit(prId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['audits', prId] });
      navigate(`/audits/${result.audit.id}`);
    },
  });

  useEffect(() => {
    if (!holdUntil) {
      return;
    }
    const remaining = holdUntil - Date.now();
    if (remaining <= 0) {
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), remaining);
    return () => window.clearTimeout(timer);
  }, [holdUntil]);

  async function start() {
    try {
      await mutation.mutateAsync();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'AUDIT_ALREADY_ACTIVE' && error.details?.audit_id) {
        navigate(`/audits/${error.details.audit_id}`, {
          state: { notice: 'An audit for this commit is already running' },
        });
        return;
      }
      if (error instanceof ApiError && error.retryAfterSeconds && error.code === 'RATE_LIMITED') {
        const until = Date.now() + error.retryAfterSeconds * 1000;
        setHoldUntil(until);
        setNow(Date.now());
      }
    }
  }

  const message = mutation.error instanceof ApiError ? presentApiError(mutation.error) : mutation.error ? 'Something went wrong. Try again.' : null;
  const held = holdUntil !== null && now < holdUntil;
  return { start, pending: mutation.isPending, message, held };
}
