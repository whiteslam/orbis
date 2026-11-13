package app.orbis.core.rules

/** Where a captured item came from. [wire] is the name the server and the settings use. */
enum class Source(val wire: String) {
    TEST("test"),
    NOTIFICATIONS("notifications"),
    CALENDAR("calendar"),
    CONTACTS("contacts"),
    CALLS("calls"),
    HEALTH("health"),
    USAGE("usage"),
    PHONE_STATE("phone_state"),
    LOCATION("location");

    companion object {
        fun fromWire(s: String): Source? = values().firstOrNull { it.wire == s }
    }
}
