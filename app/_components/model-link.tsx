import Link from "next/link";

// Links a model name to its detail page (/models/[model]). A null/unknown model
// has no detail page, so it renders as plain text. Model strings can contain
// dots and slashes, so the segment is always URL-encoded.
export function ModelLink({
  model,
  fallback,
  className,
}: {
  model: string | null | undefined;
  fallback: string;
  className?: string;
}) {
  if (!model) {
    return <span className={className}>{fallback}</span>;
  }
  return (
    <Link href={`/models/${encodeURIComponent(model)}`} className={`hover:underline ${className ?? ""}`}>
      {model}
    </Link>
  );
}
