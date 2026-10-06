import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { deleteRepository } from '../../api/repositories';
import { ApiError } from '../../api/errors';
import { presentApiError } from '../../lib/auditCopy';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

export function DeleteDialog({
  open,
  repoId,
  name,
  onClose,
  onDeleted,
}: {
  open: boolean;
  repoId: string;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: () => deleteRepository(repoId) });

  function close() {
    setTyped('');
    setError(null);
    onClose();
  }

  return (
    <Dialog open={open} title="Delete repository" onClose={close}>
      <p>
        This deletes the repository, its pull requests, and its audits. Type <strong>{name}</strong> to confirm.
      </p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed !== name) {
            return;
          }
          void mutation.mutateAsync().then(() => {
            void queryClient.invalidateQueries({ queryKey: ['repositories'] });
            onDeleted();
          }).catch((caught: unknown) => {
            setError(caught instanceof ApiError ? presentApiError(caught) : 'Something went wrong. Try again.');
          });
        }}
      >
        <label className="field">
          <span>Repository name</span>
          <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="actions">
          <Button type="submit" variant="danger" pending={mutation.isPending} disabled={typed !== name}>
            Delete
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
