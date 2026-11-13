package app.orbis.core.service

import app.orbis.core.rules.PAUSED_FOREVER
import app.orbis.core.rules.PrivacySettings
import app.orbis.core.rules.Source

/** When the foreground service should run, and what it tells the owner. Pure, so it is unit tested. */
object ServicePolicy {
    /** True only with a credential, at least one enabled source, and no pause still in force. */
    fun shouldRun(settings: PrivacySettings, now: Long, hasCredential: Boolean): Boolean =
        hasCredential && settings.enabled.isNotEmpty() && !isPaused(settings, now)

    /** The moment a finite pause ends, or null when there is no pause, it is over, or it lasts until resumed. */
    fun resumeAt(settings: PrivacySettings, now: Long): Long? {
        val until = settings.pausedUntil ?: return null
        return if (until != PAUSED_FOREVER && until > now) until else null
    }

    /** "Reading: Test source, Notifications": the enabled sources' plain labels, in source order. */
    fun notificationText(settings: PrivacySettings): String =
        "Reading: " + settings.enabled.sortedBy { it.ordinal }.joinToString(", ") { label(it) }

    fun label(source: Source): String = when (source) {
        Source.TEST -> "Test source"
        Source.NOTIFICATIONS -> "Notifications"
        Source.CALENDAR -> "Calendar"
        Source.CONTACTS -> "Contacts"
        Source.CALLS -> "Calls"
        Source.HEALTH -> "Health"
        Source.USAGE -> "App usage"
        Source.PHONE_STATE -> "Phone state"
        Source.LOCATION -> "Location"
    }

    private fun isPaused(settings: PrivacySettings, now: Long): Boolean {
        val until = settings.pausedUntil ?: return false
        return until > now
    }
}
