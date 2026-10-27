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

    /**
     * A seat in somebody's party offered to a character of yours. Subject: the party_invite. No longer
     * sent (a friend's character is seated at once, PARTY_ADDED); kept for the ones still pending.
     */
    const val PARTY_INVITE = "PARTY_INVITE"

    /** A friend seated a character of yours in their party. Subject: the party. */
    const val PARTY_ADDED = "PARTY_ADDED"

    /** Your invite was accepted or declined (payload `accepted`). No subject. */
    const val PARTY_INVITE_ANSWERED = "PARTY_INVITE_ANSWERED"

    /** A linked owner asked to combine their party with yours. Subject: the party_combine. */
    const val PARTY_COMBINE = "PARTY_COMBINE"

    /** Your combine was accepted (payload `partyId`, the kept one). No subject. */
    const val PARTY_COMBINED = "PARTY_COMBINED"

    // What somebody else did to something you share. See PartyNotices.kt. Nothing to answer. Shares
    // marked, stacks, clears and ledger entries had kinds too, and were cut as noise (V94).

    /** A drop of a party you are in sold. Subject: the drop. */
    const val SALE_RECORDED = "SALE_RECORDED"

    /** What a linked account holds for you moved (payload `amount`). Subject: the settlement_figure. */
    const val SPLIT_UPDATED = "SPLIT_UPDATED"

    /** Your payee posted a listing for what you hold. Subject: the settlement_listing. */
    const val LISTING_POSTED = "LISTING_POSTED"
}
