package ai.mafw.mafw_mobile

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {

    private lateinit var pushChannel: PushChannel

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        pushChannel = PushChannel(this)
        pushChannel.registerWithEngine(flutterEngine)
    }
}
