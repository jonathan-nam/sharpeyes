package com.sharpeyes.api.system

import kotlinx.serialization.Serializable

// Anonymous by construction: no user id, no IP is read or stored. Location is coarse
// (tz, lang) and shared by thousands, which is what makes "slow loads come from
// Australia" answerable without logging who.
@Serializable
data class VitalReport(
    val name: String,
    val value: Double,
    val rating: String? = null,
    val route: String? = null,
    val nav: String? = null,
    val conn: String? = null,
    val device: String? = null,
    val tz: String? = null,
    val lang: String? = null,
    val v: String? = null,
)
