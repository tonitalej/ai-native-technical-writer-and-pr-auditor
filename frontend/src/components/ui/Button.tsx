import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  pending = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pending?: boolean }) {
  return (
    <button
      {...props}
      className={`btn ${variant === 'ghost' ? 'btn-ghost' : ''} ${variant === 'danger' ? 'btn-danger' : ''}`.trim()}
      disabled={props.disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}
