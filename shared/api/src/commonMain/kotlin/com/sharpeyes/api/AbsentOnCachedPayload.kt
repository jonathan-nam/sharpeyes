package com.sharpeyes.api

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialInfo

/**
 * A field the server always sends but a browser can still be without, because a tab's cache holds a
 * payload from before the field existed. The generated TypeScript makes it optional, so the reader has
 * to say what absent means. Take it off once no cached payload can predate the field.
 */
@OptIn(ExperimentalSerializationApi::class)
@SerialInfo
@Target(AnnotationTarget.PROPERTY)
annotation class AbsentOnCachedPayload
