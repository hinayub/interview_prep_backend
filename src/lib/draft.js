/**
 * Unsent form input, mirrored to sessionStorage.
 *
 * A session can expire while someone is halfway through pasting a job
 * description. That sends them to /sign-in, and without this the posting they
 * pasted is gone by the time they come back — the app looks like it ate their
 * work. sessionStorage, not localStorage: a draft belongs to the tab it was
 * typed in, and should not outlive it.
 */
export const ROLE_DRAFT = 'greenroom.draft.role'

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
