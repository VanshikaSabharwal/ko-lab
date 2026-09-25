"use client";

import React, { useState, useEffect, useRef } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { FaGithub } from "react-icons/fa";
import { ChevronDown, Search, X } from "lucide-react";
import PageTour from "../components/PageTour";

type GithubRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  owner: {
    login: string;
  };
};

export default function GithubGroupCreateLogin() {
  const { data: session } = useSession();
  const router = useRouter();
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [groupName, setGroupName] = useState("");
  const [repoOpen, setRepoOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setRepoOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase()),
  );

  const fetchRepos = async () => {
    if (!session?.user?.githubAccessToken) return;

    try {
      const res = await fetch("https://api.github.com/user/repos", {
        headers: { Authorization: `Bearer ${session.user.githubAccessToken}` },
      });

      if (!res.ok) {
        toast.error("Failed to authenticate with GitHub. Please sign in again.");
        return;
      }

      const data = await res.json();
      setRepos(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Failed to load repos");
    }
  };

  useEffect(() => {
    fetchRepos();
  }, [session]);

  const handleCreateGroup = async () => {
    if (!selectedRepo || !groupName.trim()) {
      toast.error("Group name and Repo are required");
      return;
    }

    setCreating(true);

    try {
      const ownerName = selectedRepo.full_name.split("/")[0];

      const response = await fetch("/api/create-group-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName,
          githubRepo: selectedRepo.name,
          githubOwnerName: ownerName,
          githubRepoUrl: selectedRepo.html_url,
          githubAccessToken: session?.user?.githubAccessToken,
          ownerId: session?.user?.id,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(`Group "${data.groupName}" created`);
        // Straight into the new group; the button stays busy until the page changes
        router.push(`/group/${data.id}`);
        return;
      }
      toast.error(`Error: ${data.error}`);
    } catch {
      toast.error("Failed to create group");
    }
    setCreating(false);
  };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-gray-50 dark:bg-gray-950 px-4 py-8 sm:py-10">
      {!session ? (
        <div className="flex flex-col items-center justify-center py-20">
          <button
            onClick={() => signIn("github")}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:opacity-90 transition"
          >
            <FaGithub size={16} /> Login with GitHub to Create Group
          </button>
        </div>
      ) : session.user.provider !== "github" ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            You need to connect your GitHub account to create a group.
          </p>
          <button
            onClick={() => signIn("github")}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:opacity-90 transition"
          >
            <FaGithub size={16} /> Connect GitHub Account
          </button>
        </div>
      ) : (
        <div className="w-full max-w-lg mx-auto bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm p-6">
          <PageTour
            storageKey="ko-lab-tour-github"
            steps={[
              {
                id: "github-welcome",
                text: `<strong>Create a Group</strong><br/><br/>
                  Link a GitHub repo to a Ko-Lab group so your team can collaborate with real-time code editing and chat.`,
              },
              {
                id: "github-name",
                attachTo: { element: "#tour-github-name", on: "bottom" },
                text: `<strong>Group name & repo</strong><br/><br/>
                  Enter a name for your group, then pick the GitHub repo you want to link it to.`,
              },
              {
                id: "github-create",
                attachTo: { element: "#tour-github-create", on: "top" },
                text: `<strong>Create the group</strong><br/><br/>
                  Once all fields are filled, hit <em>Create Group</em> and your group will be ready.`,
              },
            ]}
          />
          <h2 className="text-xl font-bold mb-5 text-gray-900 dark:text-white">Create Group</h2>

          {/* GROUP NAME INPUT */}
          <div id="tour-github-name">
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Enter group name"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg mb-4 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            />

            {/* CUSTOM REPO DROPDOWN */}
            <div ref={dropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setRepoOpen((o) => !o)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              >
                <span className={selectedRepo ? "" : "text-gray-400"}>
                  {selectedRepo ? selectedRepo.full_name : "Select a repo"}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-gray-400 transition-transform ${repoOpen ? "rotate-180" : ""}`}
                />
              </button>

              {repoOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                    <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <input
                      autoFocus
                      type="text"
                      value={repoSearch}
                      onChange={(e) => setRepoSearch(e.target.value)}
                      placeholder="Search repos..."
                      className="flex-1 text-sm bg-transparent text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
                    />
                    {repoSearch && (
                      <button onClick={() => setRepoSearch("")}>
                        <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                      </button>
                    )}
                  </div>

                  <ul className="max-h-52 overflow-y-auto">
                    {filteredRepos.length === 0 ? (
                      <li className="px-3 py-3 text-sm text-gray-400 text-center">No repos found</li>
                    ) : (
                      filteredRepos.map((repo) => (
                        <li
                          key={repo.id}
                          onClick={() => {
                            setSelectedRepo(repo);
                            setRepoOpen(false);
                            setRepoSearch("");
                          }}
                          className={`px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                            selectedRepo?.id === repo.id
                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium"
                              : "text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                          }`}
                        >
                          {repo.full_name}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <button
            id="tour-github-create"
            onClick={handleCreateGroup}
            disabled={creating || !selectedRepo || !groupName.trim()}
            className="mt-6 w-full py-2.5 text-sm font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Creating..." : "Create Group"}
          </button>
        </div>
      )}
    </div>
  );
}
