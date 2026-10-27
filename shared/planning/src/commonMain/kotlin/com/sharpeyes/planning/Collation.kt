package com.sharpeyes.planning

/**
 * String.prototype.localeCompare as an en-US browser runs it: ICU collation, signed -1, 0 or 1. The
 * planner's last tie-break compares run ids with it, so a different collation is a different night.
 * Each platform supplies its own, as shared/money's does.
 */
internal expect fun localeCompare(
    a: String,
    b: String,
): Int
