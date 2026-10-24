package com.sharpeyes.backend.friends

/** What sending a request did. */
internal sealed interface SendOutcome {
    data object Unknown : SendOutcome

    data object Yourself : SendOutcome

    data object AlreadyFriends : SendOutcome

    data object Sent : SendOutcome

    /** They had already asked you, so asking back is accepting. */
    data object Accepted : SendOutcome

    /** The person named is not one of yours. */
    data object NoSuchPerson : SendOutcome

    /** The person named already has an account. */
    data object PersonLinked : SendOutcome
}
