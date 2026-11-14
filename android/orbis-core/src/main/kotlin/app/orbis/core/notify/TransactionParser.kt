package app.orbis.core.notify

import java.math.BigDecimal
import java.math.RoundingMode

/** A payment found in one bank or UPI alert. [amount] always has two decimals ("1250.00"). */
data class ParsedTransaction(
    val amount: String,
    val currency: String,
    val direction: String, // "expense" | "income"
    val merchant: String?,
)

/**
 * Reads a bank alert on the phone. A port of the web parser that was removed in 563a9f9
 * (lib/finance/parse-alert.ts): only one candidate segment, with one amount and one direction,
 * counts. Amounts and labels from different sentences are never combined.
 */
object TransactionParser {
    private val MONEY = Regex(
        """(?:\b(?:INR|Rs\.?|USD|US\$|EUR|GBP)\s*|[₹$€£]\s*)([0-9][0-9,]*(?:\.\d{1,2})?)""",
        RegexOption.IGNORE_CASE,
    )
    private val EXPENSE = Regex(
        """\b(debited|debit|spent|purchase|paid|withdrawn|deducted|charged|pos txn|card transaction)\b""",
        RegexOption.IGNORE_CASE,
    )
    private val INCOME = Regex(
        """\b(credited|credit|refund(?:ed)?|received|deposited|reversal)\b""",
        RegexOption.IGNORE_CASE,
    )
    private val SEGMENT_SPLIT = Regex("""\n+|;|(?<!\d),\s*|(?<=[.!?])\s+(?=[^\d\s])""")
    private val LABELED_MERCHANT = Regex(
        """\b(?:merchant(?: name)?|paid to)\s*[:\-]\s*([^\n,;]{2,80})""",
        RegexOption.IGNORE_CASE,
    )
    private val NEARBY_MERCHANT = Regex("""\b(?:at|to)\s+([^\n,;]{2,80})""", RegexOption.IGNORE_CASE)
    private val MERCHANT_TAIL = Regex(
        """\s+(?:on|using|via|ref(?:erence)?|rrn|upi|txn|transaction|available balance|a/c)\b.*$""",
        RegexOption.IGNORE_CASE,
    )
    private val MERCHANT_NOISE = Regex("""[*.#xX0-9]{3,}""")
    private val WHITESPACE = Regex("""\s+""")
    private val CURRENCY_ONLY = Regex("""^(?:INR|Rs\.?|USD|EUR|GBP|₹|\$|€|£)$""", RegexOption.IGNORE_CASE)

    private val INR = Regex("""^(?:INR|Rs\.?|₹)""", RegexOption.IGNORE_CASE)
    private val USD = Regex("""^(?:USD|US\$|\$)""", RegexOption.IGNORE_CASE)
    private val EUR = Regex("""^(?:EUR|€)""", RegexOption.IGNORE_CASE)
    private val GBP = Regex("""^(?:GBP|£)""", RegexOption.IGNORE_CASE)

    private val MAX_AMOUNT = BigDecimal(100_000_000)
    private const val MAX_INPUT = 100_000

    private data class Amount(val value: BigDecimal, val currency: String)
    private data class Segment(val text: String, val amounts: List<Amount>, val direction: String?)

    fun parse(text: String): ParsedTransaction? {
        val candidates = SEGMENT_SPLIT.split(text.take(MAX_INPUT))
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .map { parseSegment(it) }
            .filter { it.amounts.isNotEmpty() || it.direction != null }

        // Multiple candidate segments or multiple amounts are ambiguous.
        val candidate = candidates.singleOrNull() ?: return null
        val amount = candidate.amounts.singleOrNull() ?: return null
        val direction = candidate.direction ?: return null
        return ParsedTransaction(
            amount = amount.value.setScale(2, RoundingMode.HALF_UP).toPlainString(),
            currency = amount.currency,
            direction = direction,
            merchant = parseMerchant(candidate.text),
        )
    }

    private fun currencyFor(match: String): String? = when {
        INR.containsMatchIn(match) -> "INR"
        USD.containsMatchIn(match) -> "USD"
        EUR.containsMatchIn(match) -> "EUR"
        GBP.containsMatchIn(match) -> "GBP"
        else -> null
    }

    private fun parseSegment(segment: String): Segment {
        val amounts = MONEY.findAll(segment).mapNotNull { m ->
            val currency = currencyFor(m.value) ?: return@mapNotNull null
            val value = m.groupValues[1].replace(",", "").toBigDecimalOrNull() ?: return@mapNotNull null
            if (value.signum() > 0 && value <= MAX_AMOUNT) Amount(value, currency) else null
        }.toList()
        val expense = EXPENSE.containsMatchIn(segment)
        val income = INCOME.containsMatchIn(segment)
        val direction = when {
            expense == income -> null
            expense -> "expense"
            else -> "income"
        }
        return Segment(segment, amounts, direction)
    }

    private fun parseMerchant(segment: String): String? {
        val raw = (LABELED_MERCHANT.find(segment) ?: NEARBY_MERCHANT.find(segment))?.groupValues?.get(1)
            ?: return null
        val merchant = raw
            .replace(MERCHANT_TAIL, "")
            .replace(MERCHANT_NOISE, "")
            .replace(WHITESPACE, " ")
            .trim()
            .take(80)
            .trimEnd('.', ',', ':', ';') // trailing punctuation: "to SWIGGY." gives "SWIGGY"
            .trim()
        if (merchant.isEmpty() || CURRENCY_ONLY.matches(merchant)) return null
        return merchant
    }
}
