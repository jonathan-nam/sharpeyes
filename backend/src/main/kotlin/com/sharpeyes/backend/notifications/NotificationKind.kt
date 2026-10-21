package com.sharpeyes.backend.notifications

/**
 * Every kind of notification, and what its subject is. The frontend draws each kind by this name
 * (components/notification-kinds.tsx) and skips one it does not know, so adding a kind here first
 * is safe.
 */
object NotificationKind {
    /** Somebody asked to be your friend. Subject: the friend_request, which answering clears. */
    const val FRIEND_REQUEST = "FRIEND_REQUEST"

    /** Somebody accepted yours. No subject. */
    const val FRIEND_ACCEPTED = "FRIEND_ACCEPTED"
}
