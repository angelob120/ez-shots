"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { signupAction } from "./actions";
import { Button, Field, Input } from "@/components/hearth/ui";

function slugPreview(v: string) {
  return v
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creating account…" : "Create account"}
    </Button>
  );
}

// Demo scaffolding. `/signup` is a **public page**, so this is behind the
// platform's test-tools switch rather than a comment asking a future person to
// remember to delete it. See components/hearth/TestMode.tsx.
function randomSignup() {
  const token = Math.random().toString(36).slice(2, 6);
  const foods = ["Ember", "Basil", "Harbor", "Copper", "Maple", "Saffron", "Olive", "Birch"];
  const kinds = ["Coffee", "Kitchen", "Grill", "Cafe", "Bistro", "Diner", "Tacos", "Pizza"];
  const first = ["Sam", "Alex", "Jordan", "Riley", "Casey", "Morgan", "Taylor"];
  const last = ["Rivera", "Chen", "Patel", "Nguyen", "Silva", "Kim", "Brooks"];
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  const name = `${pick(foods)} ${pick(kinds)} ${token.toUpperCase()}`;
  const owner = `${pick(first)} ${pick(last)}`;
  return {
    name,
    slug: "",
    ownerName: owner,
    email: `test+${token}@test.hearth`,
    password: "test-pass-2026",
  };
}

export default function SignupForm({ testMode = false }: { testMode?: boolean }) {
  const [state, action] = useFormState(signupAction, undefined);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const effective = slugPreview(slug || name);

  function fillTestData() {
    const d = randomSignup();
    setName(d.name);
    setSlug(d.slug);
    setOwnerName(d.ownerName);
    setEmail(d.email);
    setPassword(d.password);
    setConfirm(d.password);
  }

  return (
    <form action={action} className="space-y-4">
      {testMode && (
        <button
          type="button"
          onClick={fillTestData}
          className="w-full rounded-sm border border-[#5a4a23] bg-[#1c1710] px-3 py-2 text-[12px] font-medium uppercase tracking-wide text-[#e0b455] hover:bg-[#241d12]"
        >
          Fill test data · dev only
        </button>
      )}

      <Field label="Restaurant name">
        <Input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ember Coffee"
          required
        />
      </Field>

      <Field
        label="Ordering page address"
        hint={effective ? `ezorders.app/r/${effective}` : "Leave blank to use your restaurant name."}
      >
        <Input
          name="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={slugPreview(name) || "ember-coffee"}
        />
      </Field>

      <Field label="Your name">
        <Input
          name="ownerName"
          autoComplete="name"
          placeholder="Sam Rivera"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
        />
      </Field>

      <Field label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@restaurant.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" hint="8+ characters.">
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Confirm password">
          <Input
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      </div>

      {state?.error && (
        <p className="rounded-sm border border-[#5a2723] bg-[#1c1210] px-3 py-2 text-[12px] text-[#f08a80]">
          {state.error}
        </p>
      )}

      <Submit />

      <p className="text-center text-[12px] text-mute">
        No monthly fee. Your ordering page stays private until you launch it.
      </p>
    </form>
  );
}
