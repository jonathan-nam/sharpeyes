package com.sharpeyes.planning

// The beam search behind Run Order, ported from frontend/lib/boss-run-plan.ts planNight. The ranking,
// the waiting estimate and why the beam is cut twice are explained there; this follows it step for
// step, because a tie broken differently is a different night.

/**
 * The best order to run tonight's bosses in.
 *
 * `best` is the longest plan that fits. `byCount` holds the best plan of every length from 1 up, so
 * a caller can offer "one fewer boss, three fewer relogs" without searching again.
 */
fun planNight(
    runs: List<EligibleRun>,
    options: PlanOptions,
): NightPlans {
    val byCount = NightSearch(runs, options).run()
    return NightPlans(byCount.lastOrNull() ?: EMPTY_PLAN, byCount)
}

/** One run, numbered for the inner loop, with its window worked out once. */
private class Prepared(
    val run: EligibleRun,
    val index: Int,
    val persons: IntArray,
    val pairs: IntArray,
    val size: String,
    val window: RunWindow,
)

/** The runs scheduled so far, newest first, sharing every link with the state it grew from. */
private class OrderChain(
    val planned: PlannedRun,
    val before: OrderChain?,
)

/** What the rest of the night depends on: which runs are gone, who is parked where and since when. */
private class Board(
    /** One bit per run. */
    val taken: IntArray,
    /** The character each person is on, by person. Null before they log in. */
    val parked: Array<String?>,
    /** One bit per character-and-boss pair: a character clears a boss once a period. */
    val spent: IntArray,
    /** Which run each person was last in, by person. -1 before their first. */
    val lastRunAt: IntArray,
    /** Candidate runs each person is in that are not scheduled yet, by person. */
    val left: IntArray,
)

/** What a state is ranked on. */
private class Tally(
    /** Party sizes in run order, fixed-width, so a string compare is the sequence compare. */
    val parties: String,
    val waiting: Int,
    /** The waiting already incurred by everybody still owed a run. */
    val owed: Int,
    val minutes: Double,
    val switches: Int,
)

private class State(
    val order: OrderChain?,
    val depth: Int,
    val board: Board,
    val tally: Tally,
) {
    var orderKey: String? = null
    var preferKey: String? = null

    /** The chain read back into schedule order. */
    fun runs(): List<PlannedRun> {
        val runs = ArrayList<PlannedRun>(depth)
        var link = order
        while (link != null) {
            runs += link.planned
            link = link.before
        }
        return runs.asReversed()
    }

    fun planKey(): String = orderKey ?: runs().joinToString(",") { it.run.id }.also { orderKey = it }

    fun toPlan(): Plan = Plan(runs(), tally.switches, tally.minutes)
}

/** The last comparison, between two states every rule calls equal. Total. */
private typealias Tie = (State, State) -> Int

private val byRunId: Tie = { a, b -> localeCompare(a.planKey(), b.planKey()) }

/** Ties broken toward [prefer], whose unnamed runs rank equal behind all of its named ones. */
private fun preferring(prefer: List<String>): Tie {
    val width = prefer.size.toString().length
    val rankOf = HashMap<String, String>()
    prefer.forEachIndexed { at, id -> rankOf[id] = at.toString().padStart(width, '0') }
    val unranked = prefer.size.toString().padStart(width, '0')

    fun keyOf(state: State): String =
        state.preferKey
            ?: state.runs().joinToString(",") { rankOf[it.run.id] ?: unranked }.also { state.preferKey = it }
    return { a, b ->
        val left = keyOf(a)
        val right = keyOf(b)
        if (left != right) left.compareTo(right).coerceIn(-1, 1) else byRunId(a, b)
    }
}

// 30 bits to the word, as the TypeScript packs them.
private const val WORD = 30

/** A party size as a comparison field. Two digits, because a party is six people and never 100. */
private const val MAX_FIELD = 99

private fun noBits(count: Int): IntArray = IntArray(maxOf(1, (count + WORD - 1) / WORD))

private fun hasBit(
    bits: IntArray,
    at: Int,
): Boolean = (bits[at / WORD] and (1 shl (at % WORD))) != 0

private fun setBit(
    bits: IntArray,
    at: Int,
) {
    bits[at / WORD] = bits[at / WORD] or (1 shl (at % WORD))
}

private class NightSearch(
    runs: List<EligibleRun>,
    private val options: PlanOptions,
) {
    private val tie: Tie = options.prefer?.let(::preferring) ?: byRunId
    private val prepared: List<Prepared>
    private val people: Int
    private val start: State

    // Whether a person could still fit another run: the shortest one they are in, and the clock they
    // have to be off by. Both optimistic, the safe direction for a cost.
    private val shortestRun: DoubleArray
    private val offBy: DoubleArray

    init {
        val personAt = LinkedHashMap<String, Int>()
        val pairAt = HashMap<String, Int>()
        prepared =
            runs.mapIndexed { index, run ->
                val persons = IntArray(run.seats.size)
                val pairs = IntArray(run.seats.size)
                run.seats.forEachIndexed { s, seat ->
                    persons[s] = personAt.getOrPut(seat.personId) { personAt.size }
                    pairs[s] = pairAt.getOrPut("${seat.character}::${run.bossKey}") { pairAt.size }
                }
                val size = minOf(run.seats.size, MAX_FIELD).toString().padStart(2, '0')
                Prepared(run, index, persons, pairs, size, windowOf(run, options.available))
            }
        people = personAt.size

        val runsPerPerson = IntArray(people)
        shortestRun = DoubleArray(people) { Double.POSITIVE_INFINITY }
        offBy = DoubleArray(people) { options.minutes }
        for (p in prepared) {
            p.persons.forEachIndexed { s, person ->
                runsPerPerson[person]++
                if (p.run.minutes < shortestRun[person]) shortestRun[person] = p.run.minutes
                val until = options.available[p.run.seats[s].personId]?.until
                if (until != null && until < offBy[person]) offBy[person] = until
            }
        }

        val board =
            Board(
                taken = noBits(runs.size),
                parked = arrayOfNulls(people),
                spent = noBits(pairAt.size),
                lastRunAt = IntArray(people) { -1 },
                left = runsPerPerson,
            )
        start = State(null, 0, board, Tally("", 0, 0, 0.0, 0))
    }

    fun run(): List<Plan> {
        val byCount = mutableListOf<Plan>()
        var beam = listOf(start)
        while (true) {
            beam = cut(grow(beam))
            if (beam.isEmpty()) return byCount
            // The beam is cut on the estimate, the plan of this length is picked off what survived.
            byCount += beam.reduce { leader, state -> if (pick(state, leader) < 0) state else leader }.toPlan()
        }
    }

    /** Every state one run longer, keeping the better of any two that face the same future. */
    private fun grow(beam: List<State>): List<State> {
        val next = LinkedHashMap<String, State>()
        for (state in beam) {
            for (p in prepared) {
                val (key, candidate) = extend(state, p) ?: continue
                val held = next[key]
                if (held == null || steer(candidate, held) < 0) next[key] = candidate
            }
        }
        return next.values.toList()
    }

    /** Full width to each comparator, carrying the union. See the TypeScript for why both. */
    private fun cut(pool: List<State>): List<State> {
        val steered = bestOf(pool.toMutableList(), options.beamWidth, ::steer)
        val plain = bestOf(pool.toMutableList(), options.beamWidth, ::pick)
        val kept = HashSet<State>(steered)
        for (state in plain) if (kept.add(state)) steered += state
        return steered
    }

    /** [state] with [p] run next, keyed on its future, or null where [p] cannot run next. */
    private fun extend(
        state: State,
        p: Prepared,
    ): Pair<String, State>? {
        val board = state.board
        val startsAt = if (p.window.readyAt > state.tally.minutes) p.window.readyAt else state.tally.minutes
        val minutes = startsAt + p.run.minutes
        val fits =
            !hasBit(board.taken, p.index) &&
                minutes <= options.minutes &&
                minutes <= p.window.dueBy &&
                p.pairs.none { hasBit(board.spent, it) }
        return if (fits) grown(state, p, startsAt, minutes) else null
    }

    private fun grown(
        state: State,
        p: Prepared,
        startsAt: Double,
        minutes: Double,
    ): Pair<String, State> {
        val board = state.board
        val seats = p.run.seats
        val switched =
            seats.indices
                .filter { s -> board.parked[p.persons[s]].let { it != null && it != seats[s].character } }
                .map { seats[it].personId }

        val at = state.depth
        val parked = board.parked.copyOf()
        val lastRunAt = board.lastRunAt.copyOf()
        val left = board.left.copyOf()
        val spent = board.spent.copyOf()
        var waiting = state.tally.waiting
        seats.forEachIndexed { s, seat ->
            val person = p.persons[s]
            val before = board.lastRunAt[person]
            if (before >= 0) waiting += at - before - 1
            parked[person] = seat.character
            lastRunAt[person] = at
            left[person]--
            setBit(spent, p.pairs[s])
        }
        val taken = board.taken.copyOf().also { setBit(it, p.index) }

        val next = Board(taken, parked, spent, lastRunAt, left)
        val (key, owed) = keyAndOwed(next, at, minutes)
        val waitingFor = if (startsAt > state.tally.minutes) p.window.waitsFor else emptyList()
        val planned = PlannedRun(p.run, switched, startsAt, waitingFor)
        val tally = Tally(state.tally.parties + p.size, waiting, owed, minutes, state.tally.switches + switched.size)
        return key to State(OrderChain(planned, state.order), at + 1, next, tally)
    }

    /**
     * The dedupe key, and `owed` off the same pass: it reads only what the key covers, so it cannot
     * split one. The clock is in the key because waiting for somebody makes it depend on the order.
     */
    private fun keyAndOwed(
        board: Board,
        at: Int,
        minutes: Double,
    ): Pair<String, Int> {
        var owed = 0
        val key = StringBuilder(board.taken.joinToString(",")).append('@').append(minutes)
        for (person in 0 until people) {
            val on = board.parked[person] ?: continue
            key.append("|$person>$on@${board.lastRunAt[person]}")
            if (board.left[person] > 0 && minutes + shortestRun[person] <= offBy[person]) {
                owed += at - board.lastRunAt[person]
            }
        }
        return key.toString() to owed
    }

    /** Which of two states to carry forward: waiting counted with what is already owed. */
    private fun steer(
        a: State,
        b: State,
    ): Int {
        val x = a.tally
        val y = b.tally
        return when {
            x.parties != y.parties -> if (x.parties < y.parties) 1 else -1
            x.waiting + x.owed != y.waiting + y.owed -> (x.waiting + x.owed).compareTo(y.waiting + y.owed)
            else -> settle(a, b)
        }
    }

    /** Which of two finished plans to hand back. Waiting only, because `owed` is an estimate. */
    private fun pick(
        a: State,
        b: State,
    ): Int {
        val x = a.tally
        val y = b.tally
        return when {
            x.parties != y.parties -> if (x.parties < y.parties) 1 else -1
            x.waiting != y.waiting -> x.waiting.compareTo(y.waiting)
            else -> settle(a, b)
        }
    }

    /** The rules both comparators end on: switches, then the clock, then the tie-break. */
    private fun settle(
        a: State,
        b: State,
    ): Int =
        when {
            a.tally.switches != b.tally.switches -> a.tally.switches.compareTo(b.tally.switches)
            a.tally.minutes != b.tally.minutes -> a.tally.minutes.compareTo(b.tally.minutes)
            else -> tie(a, b)
        }
}
