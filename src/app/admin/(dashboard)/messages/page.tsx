import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Badge, EmptyState, QueryErrorBanner, TextLink } from "@/components/admin/ui";
import { SubmitButton, ConfirmDeleteButton } from "@/components/admin/submit-button";
import { setContactMessageStatus, deleteContactMessage } from "./actions";
import { CONTACT_SUBJECTS } from "@/lib/contact/message";
import type { ContactMessageStatus } from "@/lib/types/database";

const SUBJECT_LABEL: Record<string, string> = Object.fromEntries(
  CONTACT_SUBJECTS.map((s) => [s.value, s.label])
);

const STATUS_TONE: Record<ContactMessageStatus, "amber" | "blue" | "neutral"> = {
  new: "amber",
  read: "blue",
  archived: "neutral",
};

const FILTERS: { value: string; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "new", label: "New" },
  { value: "read", label: "Read" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

export default async function ContactMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status: statusParam } = await searchParams;
  const filter = FILTERS.some((f) => f.value === statusParam) ? statusParam! : "open";

  const supabase = await createClient();
  let query = supabase
    .from("contact_messages")
    .select("id, name, email, subject, message, page_path, status, created_at, handled_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filter === "open") query = query.in("status", ["new", "read"]);
  // Safe: `filter` was checked against FILTERS above, and the two entries that
  // are not statuses ("open", "all") are handled by the other two branches.
  else if (filter !== "all") query = query.eq("status", filter as ContactMessageStatus);

  const { data: messages, error } = await query;

  // A failed query must never render as "no messages". Until
  // supabase/migrations_pending/20260825_contact_messages.sql is applied this
  // page WILL show this banner, saying the table does not exist — which is the
  // correct and useful answer, rather than an inbox that looks reassuringly
  // empty while the contact form is silently failing for every visitor.
  const rows = messages ?? [];

  return (
    <div>
      <PageHeader
        title="Messages"
        description="Everything sent through the public contact form. Contains other people's email addresses — admin-only, never public."
      />

      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <a
            key={f.value}
            href={`/admin/messages?status=${f.value}`}
            aria-current={filter === f.value ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm ${
              filter === f.value ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
            }`}
          >
            {f.label}
          </a>
        ))}
      </nav>

      {error && <QueryErrorBanner message={error.message} />}

      {!error && rows.length === 0 && (
        <EmptyState
          title="No messages"
          description={
            filter === "open"
              ? "Nothing waiting. Archived messages are still available under the Archived filter."
              : "Nothing matches this filter."
          }
        />
      )}

      {!error && rows.length > 0 && (
        <ul className="flex flex-col gap-3">
          {rows.map((m) => (
            <li key={m.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                  <span className="font-medium text-neutral-900">
                    {SUBJECT_LABEL[m.subject] ?? m.subject}
                  </span>
                  <span className="text-neutral-400">·</span>
                  <span className="text-neutral-600">{m.name ?? "No name given"}</span>
                  {/* mailto rather than a stored reply thread: replies are sent
                      from the admin's own mail client, so nothing about this
                      site's identity or address book lives in the database. */}
                  <a href={`mailto:${m.email}`} className="text-neutral-700 underline hover:text-neutral-900 break-all">
                    {m.email}
                  </a>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-neutral-800">{m.message}</p>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
                  <span>{new Date(m.created_at).toLocaleString()}</span>
                  {m.page_path && (
                    <>
                      <span>·</span>
                      <span>
                        sent from <TextLink href={m.page_path}>{m.page_path}</TextLink>
                      </span>
                    </>
                  )}
                  {m.handled_at && (
                    <>
                      <span>·</span>
                      <span>handled {new Date(m.handled_at).toLocaleDateString()}</span>
                    </>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {m.status === "new" && (
                    <form action={setContactMessageStatus}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="status" value="read" />
                      <SubmitButton pendingLabel="Marking...">Mark read</SubmitButton>
                    </form>
                  )}
                  {m.status !== "archived" && (
                    <form action={setContactMessageStatus}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="status" value="archived" />
                      <SubmitButton pendingLabel="Archiving...">Archive</SubmitButton>
                    </form>
                  )}
                  {m.status === "archived" && (
                    <form action={setContactMessageStatus}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="status" value="new" />
                      <SubmitButton pendingLabel="Reopening...">Reopen</SubmitButton>
                    </form>
                  )}
                  <form action={deleteContactMessage}>
                    <input type="hidden" name="id" value={m.id} />
                    <ConfirmDeleteButton confirmMessage="Delete this message permanently? Archiving keeps it; this does not." />
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
