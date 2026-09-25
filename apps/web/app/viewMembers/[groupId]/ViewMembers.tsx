import React from "react";
import prisma from "../../lib/prisma";
import CollaboratorPanel from "./CollaboratorPanel";
import UserAvatar from "../../components/UserAvatar";

interface ViewMembersProps {
  groupId: string;
}

const ViewGroupMembers: React.FC<ViewMembersProps> = async ({ groupId }) => {
  const userFields = { id: true, name: true, phone: true, image: true } as const;

  // The owner has no GroupMember row, so listing members alone left a group
  // with just its creator reading "No members found".
  const [group, members] = await Promise.all([
    prisma.group.findUnique({
      where: { id: groupId },
      select: { owner: { select: userFields } },
    }),
    prisma.groupMember.findMany({
      where: { groupId },
      include: { user: { select: userFields } },
    }),
  ]);

  const owner = group?.owner ?? null;
  const people = [
    ...(owner ? [{ ...owner, role: "Owner" }] : []),
    ...members
      .filter((m) => m.user.id !== owner?.id)
      .map((m) => ({ ...m.user, role: m.role === "ADMIN" ? "Admin" : "Member" })),
  ];

  return (
    <div className="flex flex-col items-center p-6">
      <h1 className="text-3xl font-bold mb-6">Group Members</h1>
      <ul className="space-y-3 w-full max-w-md">
        {people.map((person) => (
          <li
            key={person.id}
            className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
          >
            <UserAvatar src={person.image} name={person.name ?? person.phone} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{person.name ?? "Unnamed user"}</p>
              {person.phone && (
                <p className="text-sm text-gray-500 dark:text-gray-400">{person.phone}</p>
              )}
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                person.role === "Owner"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              }`}
            >
              {person.role}
            </span>
          </li>
        ))}
      </ul>
      {people.length <= 1 && (
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          No one else has joined yet. Add members from the group chat menu.
        </p>
      )}

      {/* Owner-only: code-access status + collaborator invites */}
      <CollaboratorPanel groupId={groupId} />
    </div>
  );
};

export default ViewGroupMembers;
