package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.invites.senderNameFor
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll

/**
 * Each account in [loggers] but [viewer] itself, named as [viewer] calls them: their own person row
 * for that account, else the account's main character. A drop's "logged by" on the Sales tab.
 * Inside a transaction.
 */
internal fun loggerNames(
    viewer: String,
    loggers: Collection<String>,
): Map<String, String> {
    val others = loggers.toSet() - viewer
    if (others.isEmpty()) return emptyMap()
    val called =
        Person
            .selectAll()
            .where { (Person.userId eq viewer) and (Person.linkedUserId inList others) }
            .associate { it[Person.linkedUserId]!! to it[Person.name] }
    return others.mapNotNull { account -> (called[account] ?: senderNameFor(account))?.let { account to it } }.toMap()
}
