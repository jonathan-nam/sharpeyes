package com.sharpeyes.api.system

import kotlinx.serialization.Serializable

/**
 * Anonymous by construction, exactly as the vitals beacon is: no user id, no IP, no request body.
 * A path is an API route ("/api/parties"), never an id-bearing one the caller composed.
 */
@Serializable
data class ClientErrorReport(
    val kind: String,
    val path: String? = null,
    val status: Int? = null,
    val route: String? = null,
    val nav: String? = null,
    val conn: String? = null,
    val device: String? = null,
    val tz: String? = null,
    val lang: String? = null,
    val v: String? = null,
    /** A parity report's first differing path. */
    val field: String? = null,
    /** A parity report's number of differing paths. */
    val count: Int? = null,
)
