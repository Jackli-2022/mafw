package ai.mafw.mafw_mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Android notification channel setup for MAFW push notifications.
 *
 * Creates and manages notification channels for MAFW messages and goals.
 * This is used by the Flutter PushService to configure native Android
 * notification behavior.
 */
class PushChannel(private val context: Context) {

    companion object {
        const val CHANNEL_ID_MESSAGES = "mafw_messages"
        const val CHANNEL_ID_GOALS = "mafw_goals"
        const val METHOD_CHANNEL_NAME = "ai.mafw.mafw_mobile/push"
    }

    private val notificationManager: NotificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    /**
     * Initialize notification channels.
     *
     * Must be called after Firebase.initializeApp() and before
     * setting up FCM token listeners.
     */
    fun initChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            createMessagesChannel()
            createGoalsChannel()
        }
    }

    /**
     * Register method channel with Flutter engine for push-related calls.
     */
    fun registerWithEngine(engine: FlutterEngine) {
        MethodChannel(engine.dartExecutor.binaryMessenger, METHOD_CHANNEL_NAME)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "createNotificationChannels" -> {
                        initChannels()
                        result.success(true)
                    }
                    "areNotificationsEnabled" -> {
                        result.success(areNotificationsEnabled())
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * Check if notifications are enabled on the device.
     */
    fun areNotificationsEnabled(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val messagesChannel = notificationManager.getNotificationChannel(CHANNEL_ID_MESSAGES)
            messagesChannel?.importance != NotificationManager.IMPORTANCE_NONE
        } else {
            true
        }
    }

    private fun createMessagesChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID_MESSAGES,
            "MAFW 消息",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "MAFW 会话消息通知"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 100, 50, 100)
            enableLights(true)
            lightColor = android.graphics.Color.parseColor("#6366F1") // indigo
        }
        notificationManager.createNotificationChannel(channel)
    }

    private fun createGoalsChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID_GOALS,
            "MAFW Goals",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Goal 状态更新通知"
            enableVibration(false)
        }
        notificationManager.createNotificationChannel(channel)
    }
}
