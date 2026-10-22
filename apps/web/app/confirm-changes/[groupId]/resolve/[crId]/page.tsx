import React from "react";
import ResolveConflicts from "./ResolveConflicts";

export default function ResolveConflictsPage({
  params,
}: {
  params: { groupId: string; crId: string };
}) {
  return <ResolveConflicts groupId={params.groupId} changeRequestId={params.crId} />;
}
