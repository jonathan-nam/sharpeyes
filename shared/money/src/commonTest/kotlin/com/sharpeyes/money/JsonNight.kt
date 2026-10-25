package com.sharpeyes.money

import com.sharpeyes.money.pieces.PlaceableNight
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive

/** A night of whichever shape the caller passed, carried as the JSON it arrived as. */
internal data class JsonNight(
    val raw: JsonObject,
) : PlaceableNight<JsonNight> {
    override val pieces get() = raw["pieces"]!!.jsonPrimitive.double
    override val droppedOn get() = raw["droppedOn"]!!.jsonPrimitive.content
    override val recordedAt get() = raw["recordedAt"]?.jsonPrimitive?.contentOrNull
    override val lootId get() = raw["lootId"]?.jsonPrimitive?.contentOrNull
    override val weekStart get() = raw["weekStart"]!!.jsonPrimitive.content

    override fun withPieces(pieces: Double) = JsonNight(JsonObject(raw + ("pieces" to JsonPrimitive(pieces))))
}
