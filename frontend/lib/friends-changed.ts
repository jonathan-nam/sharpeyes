// The bell and the Social page both show friendships, and either can change one. Each tells the
// other through this rather than sharing state: they mount in different trees (header and page).

const EVENT = "sharpeyes:friends-changed";

export function friendsChanged() {
  window.dispatchEvent(new Event(EVENT));
}

/** Calls [listener] whenever friendships change elsewhere. Returns the unsubscribe. */
export function onFriendsChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
