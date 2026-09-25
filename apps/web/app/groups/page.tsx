import prisma from "../lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";
import Link from "next/link";
import PageTour from "../components/PageTour";
import GroupAvatar from "../components/GroupAvatar";
import DeleteGroupButton from "./DeleteGroupButton";

export default async function MyGroups() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return (
      <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center px-4 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">
        <p className="text-sm text-gray-500 dark:text-gray-400">Please sign in to view your groups.</p>
      </div>
    );
  }

  const userId = session.user.id;

  const groups = await prisma.group.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
    include: {
      members: { include: { user: true } },
    },
  });

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gray-50 dark:bg-gray-950 px-4 py-8 sm:py-10">
      <PageTour
        storageKey="ko-lab-tour-groups"
        steps={[
          {
            id: "groups-welcome",
            text: `<strong>My Groups</strong><br/><br/>
              All the groups you own or are a member of are listed here.`,
          },
          {
            id: "groups-list",
            attachTo: { element: "#tour-groups-list", on: "top" },
            text: `<strong>Group cards</strong><br/><br/>
              Each card shows the group name, its linked GitHub repo, and whether you're the owner or a member.
              Click <em>Open group chat →</em> to jump straight into that group's chat.`,
          },
          {
            id: "groups-create",
            attachTo: { element: "#tour-groups-create", on: "top" },
            text: `<strong>Create a group</strong><br/><br/>
              Head to the <em>Create Group</em> page to start a new group linked to one of your GitHub repos.`,
          },
        ]}
      />
      <div className="max-w-2xl mx-auto">
        <div id="tour-groups-create" className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">My Groups</h1>
          <Link
            href="/github"
            className="text-xs font-medium text-blue-500 hover:underline"
          >
            + Create group
          </Link>
        </div>

        {groups.length > 0 ? (
          <ul id="tour-groups-list" className="space-y-3">
            {groups.map((group) => (
              <li
                key={group.id}
                className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <GroupAvatar name={group.groupName} image={group.image} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                      {group.groupName}
                    </p>
                    <a
                      href={group.githubRepo}
                      target="_blank"
                      className="text-xs text-blue-500 hover:underline truncate block mt-0.5"
                    >
                      {group.githubRepo}
                    </a>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${
                    group.ownerId === userId
                      ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                      : "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400"
                  }`}>
                    {group.ownerId === userId ? "Owner" : "Member"}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-3">
                  <Link
                    href={`/group/${group.id}`}
                    className="text-xs font-medium text-blue-500 hover:underline"
                  >
                    Open group chat →
                  </Link>
                  {group.ownerId === userId && (
                    <DeleteGroupButton groupId={group.id} ownerId={group.ownerId} userId={userId} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center py-16 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">You have no groups yet.</p>
            <Link
              href="/github"
              className="text-sm font-medium text-blue-500 hover:underline"
            >
              Create your first group →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
