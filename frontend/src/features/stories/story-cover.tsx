import { BookOpen } from "lucide-react";
import { useState } from "react";

export function StoryCover({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  const visible = Boolean(url) && !failed;
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-canvas">
      {visible ? (
        <img
          src={url ?? undefined}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted">
          <BookOpen aria-hidden size={28} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}
