package app.orbis.core.notify

import app.orbis.core.rules.Masking
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
    private val CAREER = Regex(
        """\b(interview|recruiter|shortlisted|hiring|offer letter|job (offer|opening|application)|application (received|update|status))\b""",
        RegexOption.IGNORE_CASE,
    )
    private val OTP_WORDS = Regex(
        """\b(otp|one[- ]time (password|code)|verification code|security code|login code)\b""",
        RegexOption.IGNORE_CASE,
    )
    private val CODE_NEAR_DIGITS = Regex(
        """\bcode\b[\s\S]{0,40}?(?<!\d)\d{4,8}(?!\d)|(?<!\d)\d{4,8}(?!\d)[\s\S]{0,40}?\bcode\b""",
        RegexOption.IGNORE_CASE,
    )

    private const val MAX_TEXT = 1_000
    private const val MAX_WHO = 200

    fun isOneTimeCode(text: String): Boolean =
        OTP_WORDS.containsMatchIn(text) || CODE_NEAR_DIGITS.containsMatchIn(text)

    /**
     * [rawText] is what the rules read; [maskedText] is what gets stored. A notification's text
     * starts with its title on its own line, which is where a missed call's "who" comes from.
     */
    fun sort(packageName: String?, rawText: String, maskedText: String): Sorted? {
        val base = JSONObject()
            .put("v", 1)
            .put("app", packageName ?: JSONObject.NULL)
            .put("text", maskedText.take(MAX_TEXT))

        if (packageName in DIALERS && MISSED_CALL.containsMatchIn(rawText)) {
            val who = Masking.mask(maskedText.lineSequence().first().trim()).take(MAX_WHO)
            return Sorted("missed_contact", base.put("who", who).toString())
        }
        TransactionParser.parse(rawText)?.let { t ->
            base.put("amount", t.amount)
                .put("currency", t.currency)
                .put("direction", t.direction)
                .put("merchant", t.merchant?.let { Masking.mask(it) } ?: JSONObject.NULL)
            return Sorted("transaction", base.toString())
        }
        if (PACKAGE.containsMatchIn(rawText)) return Sorted("package", base.toString())
        if (packageName in JOB_APPS && CAREER.containsMatchIn(rawText)) return Sorted("career", base.toString())
        return null
    }
}
