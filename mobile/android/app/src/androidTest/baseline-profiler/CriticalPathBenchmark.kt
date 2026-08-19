package ai.mafw.mafw_mobile.benchmark

import android.content.Intent
import android.util.Log
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.FixMethodOrder
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters

/**
 * Macrobenchmark for the MAFW Mobile critical path:
 *   SessionsPage → tap session → ChatPage
 *
 * Records a Baseline Profile that ART uses for AOT compilation,
 * reducing cold-start and navigation latency.
 *
 * Run via Android Studio Macrobenchmark config or:
 *   adb shell am instrument -w \
 *     -e class ai.mafw.mafw_mobile.benchmark.CriticalPathBenchmark \
 *     ai.mafw.mafw_mobile.test/androidx.benchmark.junit4.AndroidBenchmarkRunner
 */
@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class CriticalPathBenchmark {

    @get:Rule
    val benchmarkRule = MacrobenchmarkRule()

    private val packageName = "ai.mafw.mafw_mobile"
    private val launchActivity = "$packageName.MainActivity"
    private val sessionItemTimeout = 5_000L

    /**
     * Record baseline profile for the cold-start critical path
     * including SessionsPage → ChatPage navigation.
     *
     * This iterates the app launch + navigation to exercise
     * the hot methods that should be AOT-compiled.
     */
    @Test
    fun recordBaselineProfile() {
        benchmarkRule.measureRepeated(
            packageName = packageName,
            metrics = listOf(StartupTimingMetric()),
            iterations = 10,
            startupMode = StartupMode.COLD,
            compilationMode = CompilationMode.Partial(), // baseline profile mode
        ) {
            val intent = Intent().apply {
                setClassName(packageName, launchActivity)
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            startActivityAndWait(intent)

            // Wait for SessionsPage to render (list or empty state)
            device.waitForIdle()

            // Navigate to ChatPage by tapping the first session item
            val sessionItem = device.findObject(By.res(packageName, "session_list_item"))
                ?: device.findObject(By.scrollable(true))
            if (sessionItem != null) {
                sessionItem.click()
                device.wait(Until.hasObject(By.res(packageName, "chat_input")), sessionItemTimeout)
                device.waitForIdle()

                // Navigate back to SessionsPage
                device.pressBack()
                device.waitForIdle()
            }
        }
    }

    /**
     * Benchmark cold-start time (no baseline profile).
     * Used as the "before" comparison.
     */
    @Test
    fun coldStartNoBaseline() {
        benchmarkRule.measureRepeated(
            packageName = packageName,
            metrics = listOf(StartupTimingMetric(), FrameTimingMetric()),
            iterations = 5,
            startupMode = StartupMode.COLD,
            compilationMode = CompilationMode.None(), // no AOT
        ) {
            val intent = Intent().apply {
                setClassName(packageName, launchActivity)
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            startActivityAndWait(intent)
            device.waitForIdle()
        }
    }

    /**
     * Benchmark cold-start time (with baseline profile).
     * Used as the "after" comparison.
     */
    @Test
    fun coldStartWithBaseline() {
        benchmarkRule.measureRepeated(
            packageName = packageName,
            metrics = listOf(StartupTimingMetric(), FrameTimingMetric()),
            iterations = 5,
            startupMode = StartupMode.COLD,
            compilationMode = CompilationMode.Partial(), // baseline profile applied
        ) {
            val intent = Intent().apply {
                setClassName(packageName, launchActivity)
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            startActivityAndWait(intent)
            device.waitForIdle()
        }
    }

    /**
     * Benchmark warm-start (process alive, activity recreated).
     */
    @Test
    fun warmStart() {
        benchmarkRule.measureRepeated(
            packageName = packageName,
            metrics = listOf(StartupTimingMetric(), FrameTimingMetric()),
            iterations = 5,
            startupMode = StartupMode.WARM,
            compilationMode = CompilationMode.Partial(),
        ) {
            val intent = Intent().apply {
                setClassName(packageName, launchActivity)
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            startActivityAndWait(intent)
            device.waitForIdle()
        }
    }

    /**
     * Benchmark SessionsPage → ChatPage navigation latency.
     * Measures frame timing during the critical navigation path.
     */
    @Test
    fun navigationSessionsToChat() {
        benchmarkRule.measureRepeated(
            packageName = packageName,
            metrics = listOf(FrameTimingMetric()),
            iterations = 10,
            startupMode = StartupMode.WARM,
            compilationMode = CompilationMode.Partial(),
        ) {
            val intent = Intent().apply {
                setClassName(packageName, launchActivity)
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
            startActivityAndWait(intent)
            device.waitForIdle()

            // Tap first session to navigate to ChatPage
            val sessionItem = device.findObject(By.res(packageName, "session_list_item"))
                ?: device.findObject(By.scrollable(true))
            if (sessionItem != null) {
                sessionItem.click()
                device.wait(Until.hasObject(By.res(packageName, "chat_input")), sessionItemTimeout)
                device.waitForIdle()

                // Navigate back for next iteration
                device.pressBack()
                device.waitForIdle()
            }
        }
    }
}
