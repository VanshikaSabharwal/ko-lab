import Editor from "./Editor";
import React from "react";

export default function CodePage({
  params,
}: {
  params: { groupId: string; githubRepo: string };
}) {
  const { githubRepo } = params;
  const { groupId } = params;
  return <Editor github={githubRepo} group={groupId} />;
}
