package com.sharpeyes.planning

import com.ibm.icu.text.Collator
import com.ibm.icu.util.ULocale
import kotlin.math.sign

// ICU4J, the same collation V8 uses for localeCompare. Not Java's own Collator, which orders
// punctuation and case differently. Frozen, so it is safe to share across threads.
private val collator: Collator = Collator.getInstance(ULocale("en-US")).apply { freeze() }

internal actual fun localeCompare(
    a: String,
    b: String,
): Int = collator.compare(a, b).sign
