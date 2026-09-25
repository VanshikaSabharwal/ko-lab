"use client";

import { useEffect, useState } from "react";
import Avatar, { type AvatarUser } from "./Avatar";

interface PresenceBarProps {
  groupId: string;
  userIds: string[];
  currentUserId?: string;
}

/**
 * Who else is on this board right now. The viewer is left out — a lone avatar
 * of yourself says nothing — and people show as their photo or initials; this
 * used to print the first two characters of each user id ("CM").
 */
export default function PresenceBar({ groupId, userIds, currentUserId }: PresenceBarProps) {
  const [members, setMembers] = useState<Map<string, AvatarUser>>(new Map());
  const others = userIds.filter((id) => id !== currentUserId);
  const hasOthers = others.length > 0;

  // Names and photos come from the member list, loaded once someone else shows up
  useEffect(() => {
    if (!hasOthers || members.size > 0) return;
    fetch(`/api/groups/${encodeURIComponent(groupId)}/members`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { members?: AvatarUser[] } | null) => {
        if (data?.members) setMembers(new Map(data.members.map((m) => [m.id, m])));
      })
      .catch(() => {});
  }, [groupId, hasOthers, members.size]);

  if (!hasOthers) return null;

  return (
    <div className="flex items-center -space-x-2" aria-label="Also on this board">
      {others.map((id) => {
        const user = members.get(id) ?? { id, name: null, image: null };
        return (
          <Avatar
            key={id}
            user={user}
            size={28}
            ring
            title={`${user.name ?? "A group member"} is here`}
          />
        );
      })}
    </div>
  );
}
