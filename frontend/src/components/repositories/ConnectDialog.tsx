import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { connectRepository } from '../../api/repositories';
import { ApiError } from '../../api/errors';
import { presentApiError } from '../../lib/auditCopy';
import type { Repository } from '../../types/api';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

export function ConnectDialog({
  open,
  initialRepository = '',
  onClose,
  onConnected,
}: {
  open: boolean;
  initialRepository?: string;
  onClose: () => void;
  onConnected: (repository: Repository, created: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [repository, setRepository] = useState(initialRepository);
  const [token, setToken] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: (input: { repository: string; token: string }) => connectRepository(input.repository, input.token) });

  useEffect(() => {
    if (open) {
      setRepository(initialRepository);
      setToken('');
    }
  }, [open, initialRepository]);

  function close() {
    setToken('');
    setFormError(null);
    setTokenError(null);
    mutation.reset();
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setTokenError(null);
    const name = repository.trim();
    if (!name) {
      setFormError('Enter a repository.');
      return;
    }
    if (!token) {
      setTokenError('Enter a token.');
      return;
    }
    const submittedToken = token;
    try {
      const result = await mutation.mutateAsync({ repository: name, token: submittedToken });
      setToken('');
      mutation.reset();
      void queryClient.invalidateQueries({ queryKey: ['repositories'] });
      onConnected(result.repository, result.created);
      onClose();
    } catch (error) {
      setToken('');
      mutation.reset();
      if (error instanceof ApiError && error.code === 'GITHUB_TOKEN_INVALID') {
        setTokenError(presentApiError(error));
        return;
      }
      if (error instanceof ApiError) {
        setFormError(presentApiError(error));
        return;
      }
      setFormError('Something went wrong. Try again.');
    }
  }

  return (
    <Dialog open={open} title="Connect a repository" onClose={close}>
      <p className="help">
        Use a fine-grained, read-only token for this repository with Pull requests: Read and Contents: Read.{' '}
        <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener noreferrer">
          GitHub token settings
        </a>
      </p>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Repository</span>
          <input
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            placeholder="owner/name or GitHub URL"
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span>GitHub token</span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={tokenError ? true : undefined}
            aria-describedby={tokenError ? 'token-error' : undefined}
          />
        </label>
        {tokenError ? (
          <p id="token-error" className="error-text" role="alert">
            {tokenError}
          </p>
        ) : null}
        {formError ? (
          <p className="error-text" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="actions">
          <Button type="submit" pending={mutation.isPending}>
            Connect
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
