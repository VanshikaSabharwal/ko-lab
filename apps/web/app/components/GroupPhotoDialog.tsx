"use client";

import React, { useRef, useState } from "react";
import toast from "react-hot-toast";
import { ImagePlus, Trash2 } from "lucide-react";
import GroupAvatar from "./GroupAvatar";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

interface GroupPhotoDialogProps {
  groupId: string;
  groupName: string;
  image: string | null;
  onClose: () => void;
  /** Called with the new URL after an upload, or null after removal. */
  onChange: (image: string | null) => void;
}

/** Owner-only dialog to upload, replace, or remove the group's photo. */
export default function GroupPhotoDialog({
  groupId,
  groupName,
  image,
  onClose,
  onChange,
}: GroupPhotoDialogProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    // Checked here too so the user hears about it before the upload starts
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error("Use a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("That image is over 5MB.");
      return;
    }

    setBusy("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/groups/${groupId}/image`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to upload group photo");
        return;
      }
      onChange(data.image);
      toast.success("Group photo updated");
      onClose();
    } catch {
      toast.error("Failed to upload group photo");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    setBusy("remove");
    try {
      const res = await fetch(`/api/groups/${groupId}/image`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to remove group photo");
        return;
      }
      onChange(null);
      toast.success("Group photo removed");
      onClose();
    } catch {
      toast.error("Failed to remove group photo");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-label="Group photo"
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl"
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Group Photo</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
          Shown to everyone in the group. PNG, JPEG, or WebP, up to 5MB.
        </p>

        <div className="flex justify-center mb-5">
          <GroupAvatar name={groupName} image={image} size={112} />
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        <div className="flex flex-col gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <ImagePlus className="w-4 h-4" />
            {busy === "upload" ? "Uploading…" : image ? "Change photo" : "Upload photo"}
          </button>
          {image && (
            <button
              onClick={handleRemove}
              disabled={!!busy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              {busy === "remove" ? "Removing…" : "Remove photo"}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={!!busy}
            className="w-full px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
