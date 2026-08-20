// Two-bucket architecture (see supabase/migrations_pending). Upload always
// lands in the private bucket; publishing explicitly copies into the public
// one. Neither bucket exists in production yet — see the pending migration.
export const MEDIA_PRIVATE_BUCKET = "media-private";
export const MEDIA_PUBLIC_BUCKET = "media-public";
