import React from 'react';

export function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 ${className}`}
      aria-label="Loading"
      role="status"
    />
  );
}










