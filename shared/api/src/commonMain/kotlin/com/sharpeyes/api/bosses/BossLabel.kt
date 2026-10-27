package com.sharpeyes.api.bosses

// How a boss gets said out loud: "Chaos Kalos", "Normal Lotus". Here so every client says it the way
// the server's sentences do. The web's frontend/lib/boss-difficulty.ts is the same rule.

/** Title case, as the game writes it. Stored uppercase. */
fun difficultyLabel(difficulty: String): String = difficulty.take(1) + difficulty.drop(1).lowercase()

/** Just the name when no mode has been picked. */
fun bossLabel(
    name: String,
    difficulty: String?,
): String = if (difficulty.isNullOrEmpty()) name else "${difficultyLabel(difficulty)} $name"
