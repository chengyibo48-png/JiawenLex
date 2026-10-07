import type { ReactNode } from "react";

export function InlineMessage({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`learning-message${error ? " error-message" : ""}`} role={error ? "alert" : "status"}>{children}</div>;
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="empty-inline"><strong>{title}</strong><p>{children}</p>{action}</section>;
}

export function LoadingState({ label }: { label: string }) {
  return <section className="card learning-loading" role="status" aria-live="polite"><span>{label}</span><div className="learning-skeleton" aria-hidden="true"/><div className="learning-skeleton short" aria-hidden="true"/></section>;
}
