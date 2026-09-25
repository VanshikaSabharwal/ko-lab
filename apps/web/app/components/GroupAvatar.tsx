"use client";

import React from "react";
import Image from "next/image";

interface GroupAvatarProps {
  name: string | null | undefined;
  image?: string | null;
  /** Pixel size of the circle. */
  size?: number;
  className?: string;
}

/**
 * A group's photo, falling back to the gradient initial that groups showed
 * before photos existed.
 */
export default function GroupAvatar({ name, image, size = 36, className = "" }: GroupAvatarProps) {
  const [failed, setFailed] = React.useState(false);

  // A new upload replaces the URL; give it a fresh chance to load
  React.useEffect(() => setFailed(false), [image]);

  const showImage = image && !failed;

  return (
    <span
      style={{ width: size, height: size }}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${
        showImage ? "bg-gray-200 dark:bg-gray-800" : "bg-gradient-to-br from-blue-500 to-purple-500"
      } ${className}`}
    >
      {showImage ? (
        <Image
          src={image}
          alt={name ? `${name} photo` : "Group photo"}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          // A dead or unreachable URL falls back to the initial rather than
          // leaving a broken image.
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="font-bold leading-none text-white"
          style={{ fontSize: Math.max(10, Math.round(size * 0.4)) }}
        >
          {name?.trim()?.[0]?.toUpperCase() ?? "G"}
        </span>
      )}
    </span>
  );
}
