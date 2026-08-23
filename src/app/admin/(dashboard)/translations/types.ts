// The result shape of createTranslation().
//
// It lives in its own module rather than in actions.ts because a "use server"
// file's exports are treated as callable server actions; keeping a pure type
// out of that file removes any question about what is and is not an action.

export type CreateTranslationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };
