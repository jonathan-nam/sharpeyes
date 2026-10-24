package com.sharpeyes.backend.tokens

import kotlin.uuid.Uuid

/** The capture a clear arrived with. Its inventory read, if any, already includes the drop. */
internal data class CaptureCounts(
    val screenshotId: Uuid,
    val inventoryComplete: Boolean,
)
