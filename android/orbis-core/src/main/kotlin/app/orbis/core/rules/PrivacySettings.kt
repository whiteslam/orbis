package app.orbis.core.rules

/** [PrivacySettings.pausedUntil] value meaning "paused until the owner resumes". */
const val PAUSED_FOREVER: Long = Long.MAX_VALUE

/**
 * What the owner allows the phone to read. Every source starts off.
 *
 * [blockedContacts] holds keys made by [PrivacyRules.contactKey]. [pausedUntil] is epoch
 * milliseconds, or [PAUSED_FOREVER].
 */
data class PrivacySettings(
    val enabled: Set<Source> = emptySet(),
    val blockedPackages: Set<String> = DefaultBlocklist.PACKAGES,
    val blockedContacts: Set<String> = emptySet(),
    val blockedKeywords: List<String> = emptyList(),
    val pausedUntil: Long? = null,
) {
    companion object {
        const val PAUSED_FOREVER: Long = app.orbis.core.rules.PAUSED_FOREVER
    }
}
