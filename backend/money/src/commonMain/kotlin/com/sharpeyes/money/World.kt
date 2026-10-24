package com.sharpeyes.money

// What follows from the world a party plays in. The port of frontend/lib/world.ts's rules.

/** INTERACTIVE trades; HEROIC does not. */
fun canTrade(world: String): Boolean = world == "INTERACTIVE"

/** Whether every member gets their own copy of a drop in this world. */
fun isPerMember(
    perMember: String?,
    world: String,
): Boolean = perMember == "ALWAYS" || (perMember == "HEROIC" && world == "HEROIC")
