package app.orbis.core.rules

/** Hides secrets in text before it is stored. Nothing here shortens the text. */
object Masking {
    private val IGNORE = setOf(RegexOption.IGNORE_CASE)

    // 1. "password: hunter2" -> "password [hidden]" (the word as written is kept).
    private val SECRET_WORD = Regex("""\b(password|passwd|pwd|pin|cvv)\b\s*(?:is\b|:|=)?\s*\S+""", IGNORE)

    // 2. Text that talks about a code gets its standalone 4-8 digit numbers hidden.
    private val CODE_WORD = Regex("""\b(otp|one[- ]time|verification|passcode|security code|code)\b""", IGNORE)

    // Standalone: not glued to letters or digits, and not a piece of a date, time or amount.
    private val SHORT_NUMBER = Regex("""(?<!\w)(?<!\d[.,:/-])\d{4,8}(?!\w|[.,:/-]\d)""")

    // 3. A run of digits, with single spaces or hyphens between groups. It starts and ends on
    // a digit, so trailing punctuation stays. Only runs of 9 or more digits are masked.
    private val DIGIT_RUN = Regex("""\d+(?:[ -]\d+)*""")
    private const val MIN_LONG_DIGITS = 9
    private const val DOTS = "\u2022\u2022\u2022\u2022"

    fun mask(text: String): String {
        var out = SECRET_WORD.replace(text) { "${it.groupValues[1]} [hidden]" }
        if (CODE_WORD.containsMatchIn(out)) {
            out = SHORT_NUMBER.replace(out, "[code]")
        }
        return DIGIT_RUN.replace(out) { m ->
            val digits = m.value.filter { it in '0'..'9' }
            if (digits.length >= MIN_LONG_DIGITS) DOTS + digits.takeLast(4) else m.value
        }
    }
}
