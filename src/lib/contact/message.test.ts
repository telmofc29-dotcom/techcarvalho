import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateContactDraft,
  contactFailureMessage,
  CONTACT_SUBJECT_VALUES,
  MESSAGE_MIN_LENGTH,
  MESSAGE_MAX_LENGTH,
  NAME_MAX_LENGTH,
  type ContactDraft,
} from "./message.ts";

function draft(overrides: Partial<ContactDraft> = {}): ContactDraft {
  return {
    name: "A Reader",
    email: "reader@example.com",
    subject: "correction",
    message: "The launch date in the third paragraph is a year out.",
    pagePath: "/articles/wifi-7-explained-what-changes",
    honeypot: "",
    ...overrides,
  };
}

test("a well-formed message validates and is normalised", () => {
  const result = validateContactDraft(draft({ email: "  Reader@Example.COM " }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.email, "reader@example.com");
  assert.equal(result.value.name, "A Reader");
  assert.equal(result.value.subject, "correction");
});

test("an empty name becomes null rather than an empty string", () => {
  const result = validateContactDraft(draft({ name: "   " }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, null);
});

test("a filled honeypot is rejected before anything else is even checked", () => {
  // Deliberately invalid in every other way too: honeypot must win, so the
  // response can never differ depending on what else the bot got wrong.
  const result = validateContactDraft(draft({ honeypot: "http://spam.example", email: "nope", message: "x" }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "honeypot");
});

test("addresses with no @ or no dot are rejected", () => {
  for (const email of ["reader", "reader@example", "reader example.com", "@example.com", ""]) {
    const result = validateContactDraft(draft({ email }));
    assert.equal(result.ok, false, `expected ${JSON.stringify(email)} to be rejected`);
  }
});

test("subjects outside the closed vocabulary are rejected", () => {
  const result = validateContactDraft(draft({ subject: "buy-cheap-pills" }));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "invalid_subject");
});

test("every offered subject value passes validation", () => {
  for (const subject of CONTACT_SUBJECT_VALUES) {
    assert.equal(validateContactDraft(draft({ subject })).ok, true, `subject ${subject} should be accepted`);
  }
});

test("messages below the floor and above the ceiling are rejected", () => {
  assert.equal(validateContactDraft(draft({ message: "a".repeat(MESSAGE_MIN_LENGTH - 1) })).ok, false);
  assert.equal(validateContactDraft(draft({ message: "a".repeat(MESSAGE_MIN_LENGTH) })).ok, true);
  assert.equal(validateContactDraft(draft({ message: "a".repeat(MESSAGE_MAX_LENGTH) })).ok, true);
  assert.equal(validateContactDraft(draft({ message: "a".repeat(MESSAGE_MAX_LENGTH + 1) })).ok, false);
});

test("whitespace padding cannot smuggle a too-short message past the floor", () => {
  const result = validateContactDraft(draft({ message: `  ${"a".repeat(MESSAGE_MIN_LENGTH - 1)}   ` }));
  assert.equal(result.ok, false);
});

test("an over-long name is rejected", () => {
  assert.equal(validateContactDraft(draft({ name: "a".repeat(NAME_MAX_LENGTH + 1) })).ok, false);
});

test("page_path only ever survives as a same-site path", () => {
  // A protocol-relative or absolute URL would let a submitted form record an
  // arbitrary external address as the page the sender was on.
  for (const pagePath of ["https://evil.example/x", "//evil.example/x", "evil", ""]) {
    const result = validateContactDraft(draft({ pagePath }));
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.pagePath, null, `expected ${JSON.stringify(pagePath)} to be dropped`);
  }
  const kept = validateContactDraft(draft({ pagePath: "/products/rtx-5090" }));
  assert.equal(kept.ok, true);
  if (!kept.ok) return;
  assert.equal(kept.value.pagePath, "/products/rtx-5090");
});

test("every failure reason has a message that says what happened", () => {
  const reasons = [
    "invalid_email",
    "invalid_subject",
    "invalid_message",
    "invalid_name",
    "honeypot",
    "rate_limited_sender",
    "rate_limited_site",
    "storage_unavailable",
    "unknown",
  ] as const;
  for (const reason of reasons) {
    const text = contactFailureMessage(reason);
    assert.ok(text.length > 10, `${reason} needs a real explanation`);
  }
});

test("a storage failure never tells the sender the message was sent", () => {
  // The whole point of the distinction: "we couldn't save it" must not read
  // like "we got it". This is the same empty-vs-failed rule the public pages
  // follow, applied to a form.
  const text = contactFailureMessage("storage_unavailable");
  assert.ok(/not been sent|not sent/i.test(text));
});
