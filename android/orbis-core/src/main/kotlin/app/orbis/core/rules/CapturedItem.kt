package app.orbis.core.rules

/** One thing read from the phone, before the privacy rules have looked at it. */
data class CapturedItem(
    val source: Source,
    val packageName: String?,
    val contacts: List<String>,
    val text: String,
    val occurredAt: Long,
    val fromOtherProfile: Boolean = false,
)
