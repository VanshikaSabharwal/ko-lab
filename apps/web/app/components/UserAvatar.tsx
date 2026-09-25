"use client";

import { useEffect, useState } from "react";

/**
 * A user's profile photo, or their initial on a gradient when they have none.
 *
 * Plain <img> rather than next/image: photos come from several hosts (R2,
 * GitHub, Google, LocalStack) and a URL that fails to load — expired, or from
 * a host next/image isn't configured for — should fall back to the initial
 * instead of leaving broken-image alt text in a 32px circle.
 */
export default function UserAvatar({
  src,
  name,
  size = 36,
  className = "",
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const dimensions = { width: size, height: size };

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? "User"}
        style={dimensions}
        // Google avatars refuse hotlinked requests that carry a referrer
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      aria-label={name ?? "User"}
      style={{ ...dimensions, fontSize: Math.round(size * 0.4) }}
      className={`rounded-full shrink-0 bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-bold select-none ${className}`}
    >
      {(name?.trim()[0] ?? "?").toUpperCase()}
    </div>
  );
}
