import { ErrorAlert } from '@/components/ErrorAlert';

export function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      <ErrorAlert error={error} />
      {notice && (
        <div className="alert ok" role="status">
          {notice}
        </div>
      )}
    </>
  );
}
