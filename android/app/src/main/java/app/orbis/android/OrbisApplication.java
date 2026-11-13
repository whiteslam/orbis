package app.orbis.android;

import android.app.Application;
import androidx.core.app.NotificationChannelCompat;
import androidx.core.app.NotificationManagerCompat;
import app.orbis.core.service.CoreController;

public class OrbisApplication extends Application {

    public static final String CHANNEL_ID = "orbis";

    @Override
    public void onCreate() {
        super.onCreate();
        // One channel for everything Orbis posts. Creating it again is a no-op,
        // and the compat call does nothing below Android 8.
        NotificationManagerCompat.from(this).createNotificationChannel(
            new NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_DEFAULT)
                .setName("Orbis")
                .build()
        );
        // A revoke found by the sync worker stops the foreground service in any process that runs it.
        CoreController.INSTANCE.install();
    }
}
