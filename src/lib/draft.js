/**
 * The application being worked on right now, mirrored to sessionStorage.
 *
 * Two things live here. The unsent role form, because a session can expire while
 * someone is halfway through pasting a job description: that sends them to
 * /sign-in, and without this the posting they pasted is gone by the time they come
 * back — the app looks like it ate their work.
 *
 * And the pair of ids they are working against. That is deliberately not read off
 * "the newest row on file": signing in should open an empty bench rather than
 * resurrect the application you finished last week, and every run has to attach to
 * the pair actually on screen or it lands in a history record of its own.
 *
 * sessionStorage, not localStorage: this belongs to the tab it was typed in and
 * should not outlive it.
 */
export const ROLE_DRAFT = 'greenroom.draft.role'

/** `{ resumeId, roleId }` — either half may be null while it is being filled in. */
export const PAIR_DRAFT = 'greenroom.draft.pair'

export const EMPTY_PAIR = { resumeId: null, roleId: null }

export function readDraft(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    // Corrupt or unavailable storage means no draft, never a crash.
    return null
  }
}

export function writeDraft(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private-browsing mode: the draft simply will not survive a redirect.
  }
}

export function clearDraft(key) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Nothing to do — storage is unavailable, so there is no draft to clear.
  }
}

/**
 * Put the bench back to empty: no pair, no typed posting.
 *
 * What signing out does, and what "start a new application" does — the same act
 * either way, since both mean the work in this tab is finished with.
 */
export function clearWorkspace() {
  clearDraft(ROLE_DRAFT)
  clearDraft(PAIR_DRAFT)
}
