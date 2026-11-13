package app.orbis.core.rules

/** Hides secrets in text before it is stored. Nothing here shortens the text. */
object Masking {
    private val IGNORE = setOf(RegexOption.IGNORE_CASE)

    // Dates (dd-mm-yy, dd-mm-yyyy, yyyy-mm-dd, with - or /) and times (10:30, 10:30:15) are
    // matched first by rules 2 and 3 and left as they are. A digit group is never joined
    // across or into a date, and never joined when it starts a time (followed by ":" and two
    // digits). A plain ":" after it ("Card 4111 1111 1111 1111: declined") is punctuation.
    private const val NOT_A_TIME = """(?!\d|:\d{2})"""
    private const val DATE = """(?:\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})(?!\d)"""
    private const val TIME = """\d{1,2}:\d{2}(?::\d{2})?"""
    private const val KEEP = """(?<keep>$DATE|$TIME)"""
    private const val JOINED_GROUP = """[ -](?!$DATE)"""

    // 1. "password: hunter2" -> "password [hidden]" (the word as written is kept).
    private val SECRET_WORD = Regex("""\b(password|passwd|pwd|pin|cvv)\b\s*(?:is\b|:|=)?\s*\S+""", IGNORE)

    // 2. Text that talks about a code gets its standalone code numbers hidden. This is checked
    // on the original text, before rule 1 has removed any words.
    private val CODE_WORD = Regex(
        """\b(otp|one[- ]time|verif\w*|passcode|security code|code|pin|password|passwd|pwd|cvv)\b""",
        IGNORE,
    )

    // A code is 4-8 digits in one piece, or groups of 2-4 digits joined by single spaces or
    // hyphens that total 4-8 digits ("123-456"). It must not be glued to letters or digits,
    // follow a mask dot (so masking twice changes nothing), or be a piece of a date, time or amount.
    private const val CODE_START = """(?<![\w•])(?<!\d[.,:/-])"""
    private const val CODE_END = """(?!\w|[.,:/-]\d)"""
    private val CODE_NUMBER = Regex(
        """$KEEP|""" +
            """(?<split>$CODE_START\d{2,4}(?:$JOINED_GROUP\d{2,4}$NOT_A_TIME)+$CODE_END)|""" +
            """(?<single>$CODE_START\d{4,8}$CODE_END)""",
    )
    private const val MIN_CODE_DIGITS = 4
    private const val MAX_CODE_DIGITS = 8

    // 3. A run of digits, with single spaces or hyphens between groups. It starts and ends on
    // a digit, so trailing punctuation stays. Only runs of 9 or more digits are masked.
    private val DIGIT_RUN = Regex("""$KEEP|(?<run>\d+(?:$JOINED_GROUP\d+$NOT_A_TIME)*)""")
    private const val MIN_LONG_DIGITS = 9
    private const val DOTS = "••••"

    fun mask(text: String): String {
        val inCodeContext = CODE_WORD.containsMatchIn(text)
        var out = SECRET_WORD.replace(text) { "${it.groupValues[1]} [hidden]" }
        if (inCodeContext) {
            out = CODE_NUMBER.replace(out) { m ->
                if (m.groups["keep"] != null) return@replace m.value
                val digits = m.value.count { it in '0'..'9' }
                if (digits in MIN_CODE_DIGITS..MAX_CODE_DIGITS) "[code]" else m.value
            }
        }
        return DIGIT_RUN.replace(out) { m ->
            if (m.groups["run"] == null) return@replace m.value
            val digits = m.value.filter { it in '0'..'9' }
            if (digits.length >= MIN_LONG_DIGITS) DOTS + digits.takeLast(4) else m.value
        }
    }
}
