package com.sharpeyes.backend.events

/**
 * What a live event says changed, and so what a page should read again. The frontend matches these
 * names (lib/live-events.ts) and ignores one it does not know.
 */
object Topic {
    /** A clear moved on a character of yours, or on a party you are in. */
    const val CLEARS = "clears"

    /** Something arrived on your bell. */
    const val NOTIFICATIONS = "notifications"
}
