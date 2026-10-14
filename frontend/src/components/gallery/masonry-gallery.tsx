import { Children, type ReactNode } from "react";
import "./masonry-gallery.css";

/** CSS columns preserve media aspect ratios without duplicating business/card logic. */
export function MasonryGallery({ children, enabled = true, className = "" }: { children: ReactNode; enabled?: boolean; className?: string }) {
  return <div className={enabled ? `masonry-gallery ${className}` : className}>
    {enabled ? Children.map(children, child => child && <div className="masonry-gallery-item">{child}</div>) : children}
  </div>;
}
