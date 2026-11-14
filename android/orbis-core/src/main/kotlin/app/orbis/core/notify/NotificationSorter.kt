package app.orbis.core.notify

import app.orbis.core.rules.Masking
import app.orbis.core.store.CapturePipeline
import org.json.JSONObject

/** What a notification or text turned out to be, with the JSON the server stores for it. */
data class Sorted(val kind: String, val content: String)

/**
 * Sorts one notification or text into a kind Orbis cares about: a payment, a delivery, a missed
 * call or job mail. Everything else returns null and is only kept as a plain item.
 */
object NotificationSorter {
    private val DIALERS = setOf(
        "com.google.android.dialer",
        "com.samsung.android.dialer",
        "com.android.dialer",
        "com.android.server.telecom",
        "com.whatsapp",
        "com.whatsapp.w4b",
    )
    private val JOB_APPS = setOf(
        "com.google.android.gm",
        "com.microsoft.office.outlook",
        "com.linkedin.android",
        "naukriApp.appModules.login",
        "com.indeed.android.jobsearch",
    )

    private val MISSED_CALL = Regex("""\bmissed (voice |video )?call""", RegexOption.IGNORE_CASE)
    private val PACKAGE = Regex(
        """\b(out for delivery|delivered|shipped|dispatched|arriving (today|tomorrow)|order (has been )?(placed|confirmed))\b""",
        RegexOption.IGNORE_CASE,
    )
    // A delivery word alone is not a delivery ("the baby was delivered"): a shipment must be named.
    private val SHIPMENT = Regex(
        """\b(orders?|packages?|parcels?|shipments?|awb|tracking|consignments?)\b""",
        RegexOption.IGNORE_CASE,
    )
    // Personal chat is never sorted as a delivery, so its text never leaves the phone that way.
    // Messages stays allowed: bank and courier texts arrive through it.
    private val CHAT_APPS = setOf(
        "com.whatsapp",
        "com.whatsapp.w4b",
        "org.telegram.messenger",
        "org.thoughtcrime.securesms",
        "com.instagram.android",
        "com.facebook.orca",
    )
    private val CAREER = Regex(
        """\b(interview|recruiter|shortlisted|hiring|offer letter|job (offer|opening|application)|application (received|update|status))\b""",
        RegexOption.IGNORE_CASE,
    )

    // A one-time code is a standalone 4-8 digit number next to an OTP word or the word "code".
    // Amounts ("Rs 2500", "$4500", "12,000.50"), ids glued to letters ("HDFC0001234") and card or
    // account numbers ("card ending 1234") are not codes.
    private val OTP_WORD = Regex(
        """\b(otp|one[- ]time (password|code)|verification code|security code|login code|passcode|code)\b""",
        RegexOption.IGNORE_CASE,
    )
    private val CODE_RUN = Regex("""(?<![\w.,])\d{4,8}(?!\w|[.,]\d)""")
    private val CURRENCY_BEFORE = Regex("""(?:\b(?:rs\.?|inr|usd|eur|gbp)|[₹$€£])\s{0,2}$""", RegexOption.IGNORE_CASE)
    // A card or account number ("card ending 1234", "a/c **1234", "Account no. 482193") is not
    // a code, even with a "never share your OTP" footer next to it: the marker must come right
    // before the number, with only spaces or punctuation between.
    private val ACCOUNT_BEFORE = Regex(
        """(?:\b(?:ending(?:\s+(?:in|with))?|a/c|acct|account|card|no|number)|\bx{2,}|\*)[\s:.#*-]*$""",
        RegexOption.IGNORE_CASE,
    )
    private const val CODE_REACH = 40
    private const val CURRENCY_REACH = 8
    private const val ACCOUNT_REACH = 16

    private const val MAX_TEXT = 1_000
    private const val MAX_WHO = 200
    private const val MAX_MERCHANT = 80
    private const val MAX_APP = 200

    fun isOneTimeCode(text: String): Boolean = CODE_RUN.findAll(text).any { run ->
        val start = run.range.first
        val end = run.range.last + 1
        val amount = CURRENCY_BEFORE.containsMatchIn(text.substring(maxOf(0, start - CURRENCY_REACH), start))
        val account = ACCOUNT_BEFORE.containsMatchIn(text.substring(maxOf(0, start - ACCOUNT_REACH), start))
        !amount && !account && (
            OTP_WORD.containsMatchIn(text.substring(maxOf(0, start - CODE_REACH), start)) ||
                OTP_WORD.containsMatchIn(text.substring(end, minOf(text.length, end + CODE_REACH)))
            )
    }

    /**
     * [rawText] is what the rules read; [maskedText] is what gets stored. A notification's text
     * starts with its title on its own line, which is where a missed call's "who" comes from.
     * The content is always safe for the server: no lone surrogates, at most 4,000 characters.
     */
    fun sort(packageName: String?, rawText: String, maskedText: String): Sorted? {
        val app = packageName?.let { CapturePipeline.signalContent(it, MAX_APP) }

        if (packageName in DIALERS && MISSED_CALL.containsMatchIn(rawText)) {
            val who = maskedText.lineSequence().map { it.trim() }
                .firstOrNull { it.isNotEmpty() && !MISSED_CALL.containsMatchIn(it) }
                ?.let { CapturePipeline.signalContent(it, MAX_WHO) }
                ?.takeIf { it.isNotEmpty() }
            return build("missed_contact", app, maskedText, if (who == null) emptyMap() else mapOf("who" to who))
        }
        parsePayment(rawText)?.let { t ->
            val merchant = t.merchant
                ?.let { CapturePipeline.signalContent(Masking.mask(it), MAX_MERCHANT) }
                ?.takeIf { it.isNotEmpty() }
            return build(
                "transaction", app, maskedText,
                mapOf(
                    "amount" to t.amount,
                    "currency" to t.currency,
                    "direction" to t.direction,
                    "merchant" to (merchant ?: JSONObject.NULL),
                ),
            )
        }
        if (packageName !in CHAT_APPS && PACKAGE.containsMatchIn(rawText) && SHIPMENT.containsMatchIn(rawText)) {
            return build("package", app, maskedText, emptyMap())
        }
        if (packageName in JOB_APPS && CAREER.containsMatchIn(rawText)) return build("career", app, maskedText, emptyMap())
        return null
    }

    /**
     * A notification's text is its title line, then its body. UPI apps split a payment across the
     * two ("Payment received" / "₹500 credited to your account"), and the parser counts each line
     * as its own candidate, so the whole text is ambiguous. Try the body first, then the title,
     * then the whole text; the first that parses wins.
     */
    private fun parsePayment(rawText: String): ParsedTransaction? {
        val newline = rawText.indexOf('\n')
        if (newline < 0) return TransactionParser.parse(rawText)
        return TransactionParser.parse(rawText.substring(newline + 1))
            ?: TransactionParser.parse(rawText.substring(0, newline))
            ?: TransactionParser.parse(rawText)
    }

    /** Builds the JSON, shortening `text` until the whole content is at most 4,000 characters. */
    private fun build(kind: String, app: String?, maskedText: String, extra: Map<String, Any>): Sorted {
        var limit = MAX_TEXT
        while (true) {
            val text = CapturePipeline.signalContent(maskedText, limit)
            val json = JSONObject()
                .put("v", 1)
                .put("app", app ?: JSONObject.NULL)
                .put("text", text)
            extra.forEach { (k, v) -> json.put(k, v) }
            val s = json.toString()
            if (s.length <= CapturePipeline.MAX_CONTENT_CHARS || text.isEmpty()) return Sorted(kind, s)
            // An escaped character takes up to 6 units, so cut a sixth of the excess (at least one
            // character) and measure again.
            limit = maxOf(0, text.length - maxOf(1, (s.length - CapturePipeline.MAX_CONTENT_CHARS) / 6))
        }
    }
}
