package com.kevins.thecut;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Reads TYPE_STEP_COUNTER — the low-power counter in the phone's sensor hub, present on every
 * modern Android device regardless of maker. No Samsung Health, no Mi Fitness, no account.
 *
 * The value is steps since the device last booted, not steps today; turning that into a daily
 * figure (including surviving a reboot) is stepTally() in tracker-core.js, where it is tested.
 * This side only hands over the current reading.
 */
@CapacitorPlugin(
    name = "StepCounter",
    permissions = {
        @Permission(alias = StepCounter.ACTIVITY, strings = { Manifest.permission.ACTIVITY_RECOGNITION })
    }
)
public class StepCounter extends Plugin {

    static final String ACTIVITY = "activity";

    /* The sensor usually reports on registration, but it is not obliged to be instant. Rather
       than leave the JS promise hanging forever, give up and say so. */
    private static final long READ_TIMEOUT_MS = 4000;

    private boolean hasSensor() {
        return getContext().getPackageManager()
                .hasSystemFeature(PackageManager.FEATURE_SENSOR_STEP_COUNTER);
    }

    /* ACTIVITY_RECOGNITION only exists from API 29; below that the sensor is readable outright. */
    private boolean granted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return getPermissionState(ACTIVITY) == com.getcapacitor.PermissionState.GRANTED;
    }

    private JSObject status(boolean permitted) {
        JSObject r = new JSObject();
        r.put("available", hasSensor());
        r.put("permitted", permitted);
        return r;
    }

    @PluginMethod
    public void check(PluginCall call) {
        call.resolve(status(granted()));
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (!hasSensor() || granted()) {
            call.resolve(status(granted()));
            return;
        }
        requestPermissionForAlias(ACTIVITY, call, "afterRequest");
    }

    @PermissionCallback
    private void afterRequest(PluginCall call) {
        call.resolve(status(granted()));
    }

    @PluginMethod
    public void read(final PluginCall call) {
        if (!hasSensor() || !granted()) {
            call.resolve(status(granted()));
            return;
        }

        final SensorManager sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        Sensor sensor = (sm == null) ? null : sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        if (sensor == null) {
            JSObject r = status(true);
            r.put("available", false);          /* the feature flag lied, or the sensor is gone */
            call.resolve(r);
            return;
        }

        /* The callback can land on a sensor thread while the timeout runs on the main one, and
           whichever gets here first must be the only one to resolve the call. */
        final AtomicBoolean done = new AtomicBoolean(false);

        final SensorEventListener listener = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent event) {
                if (!done.compareAndSet(false, true)) return;
                sm.unregisterListener(this);
                JSObject r = status(true);
                r.put("value", (long) event.values[0]);
                call.resolve(r);
            }
            @Override public void onAccuracyChanged(Sensor s, int accuracy) { }
        };

        sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_FASTEST);

        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override public void run() {
                if (!done.compareAndSet(false, true)) return;
                sm.unregisterListener(listener);
                call.resolve(status(true));     /* no `value` — the caller leaves the day alone */
            }
        }, READ_TIMEOUT_MS);
    }
}
