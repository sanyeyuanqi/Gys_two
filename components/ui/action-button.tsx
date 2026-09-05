'use client';

import type { ComponentPropsWithRef } from 'react';

/** Shared application action; native button behavior and forwarded refs are preserved. */
export function ActionButton({ className = '', type = 'button', ...props }: ComponentPropsWithRef<'button'>) {
  const destructive = /(?:danger|delete|destructive)/.test(className);
  return <button {...props} type={type} data-action-button="true"
    data-action-tone={destructive ? 'danger' : 'default'}
    className={`app-action-button ${className}`} />;
}
