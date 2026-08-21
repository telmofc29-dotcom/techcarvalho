"use client";

import { useState, type ReactNode, type FormEvent } from "react";
import { findCannibalisationMatches, type ContentSignal } from "@/lib/admin/cannibalisation";
import { Badge, TextLink } from "./ui";

// Wraps a ReferenceForm (passed as children) without modifying it. Reads
// live input values via native DOM event bubbling from the form's title/
// primary_query/intent_fingerprint fields (ReferenceForm always names
// inputs after their field key — see reference-form.tsx), so this needs no
// changes to the shared form component and works for both the "new" and
// "edit" content pages.
export function CannibalisationCheck({
  existing,
  initialTitle = "",
  initialPrimaryQuery = "",
  initialIntentFingerprint = "",
  children,
}: {
  existing: ContentSignal[];
  initialTitle?: string;
  initialPrimaryQuery?: string;
  initialIntentFingerprint?: string;
  children: ReactNode;
}) {
  const [signal, setSignal] = useState({
    title: initialTitle,
    primary_query: initialPrimaryQuery,
    intent_fingerprint: initialIntentFingerprint,
  });

  function handleInput(event: FormEvent<HTMLDivElement>) {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (target.name === "title" || target.name === "primary_query" || target.name === "intent_fingerprint") {
      setSignal((prev) => ({ ...prev, [target.name]: target.value }));
    }
  }

  const matches = findCannibalisationMatches(signal, existing);

  return (
    <div onInput={handleInput}>
      {matches.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 mb-4">
          <p className="text-sm font-medium text-amber-900 mb-2">
            This may overlap with existing content — not blocked, just worth checking:
          </p>
          <ul className="flex flex-col gap-1">
            {matches.map((match) => (
              <li key={match.id} className="text-sm text-amber-800 flex items-center gap-2">
                <Badge tone="amber">{match.reason}</Badge>
                <TextLink href={`/admin/content/${match.id}`}>{match.title}</TextLink>
              </li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </div>
  );
}
