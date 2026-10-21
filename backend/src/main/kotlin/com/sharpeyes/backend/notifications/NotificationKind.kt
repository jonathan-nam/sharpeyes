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

    // What somebody else did to something you share. See PartyNotices.kt. Nothing to answer.

    /** A drop of a party you are in sold. Subject: the drop. */
    const val SALE_RECORDED = "SALE_RECORDED"

    /** A share marked paid or taken back, or a lot marked sent or offset. Subject: the drop, or none. */
    const val SHARE_MARKED = "SHARE_MARKED"

    /** Who picked up a coupon drop's stacks, said or corrected. Subject: the drop. */
    const val STACKS_CHANGED = "STACKS_CHANGED"

    /** A shared party's clear ticked or taken back. No subject. */
    const val CLEAR_MARKED = "CLEAR_MARKED"

    /** A debt or payment written into a book you share. No subject. */
    const val LEDGER_ENTRY = "LEDGER_ENTRY"
}
