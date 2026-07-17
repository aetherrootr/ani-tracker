export function AuthErrorMessage({ id, message }: { id?: string; message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div id={id} role="alert" tabIndex={-1} className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
      {message}
    </div>
  );
}
