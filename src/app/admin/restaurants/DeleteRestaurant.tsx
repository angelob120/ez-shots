"use client";

import { useState } from "react";
import { Button } from "@/components/hearth/ui";

export default function DeleteRestaurant({
  id,
  slug,
  action,
}: {
  id: string;
  slug: string;
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  if (!open) {
    return (
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        Delete
      </Button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        name="confirm"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={`type ${slug}`}
        className="h-8 w-40 rounded-sm border border-badLine bg-badBg px-2 font-mono text-[12px] text-ink outline-none"
      />
      <Button size="sm" variant="danger" disabled={confirm !== slug}>
        Confirm
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}
