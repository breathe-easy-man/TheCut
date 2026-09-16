package com.kevins.thecut;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The only door between the WebView and the home-screen widget.
 *
 * The widget runs in the launcher's process and cannot read WebView localStorage, so index.html
 * pushes an already-computed blob into SharedPreferences and CutWidget just renders it. Every
 * number — targets, deficits, percentages — is worked out in JS where it is already tested;
 * this side stays dumb on purpose.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridge extends Plugin {

    private static final String PREFS = "cut_widget";
    private static final String KEY = "state";

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String readState(Context ctx) {
        return prefs(ctx).getString(KEY, "{}");
    }

    /* commit(), not apply(): the widget's onReceive can be killed the moment it returns. */
    static void write(Context ctx, String json) {
        prefs(ctx).edit().putString(KEY, json).commit();
    }

    @PluginMethod
    public void sync(PluginCall call) {
        write(getContext(), call.getString("state", "{}"));
        CutWidget.refresh(getContext());
        call.resolve();
    }

    /**
     * Whether this launch came from the widget's Add meal button, answered once.
     *
     * The extra is removed as it is handed over: the activity is singleTask, so the same Intent
     * is still attached on every later resume, and leaving it in place would re-open the camera
     * every time the app came back to the foreground.
     */
    @PluginMethod
    public void consumeAction(PluginCall call) {
        boolean shoot = false;
        if (getActivity() != null) {
            Intent i = getActivity().getIntent();
            if (i != null && i.getBooleanExtra(CutWidget.EXTRA_SHOOT, false)) {
                shoot = true;
                i.removeExtra(CutWidget.EXTRA_SHOOT);
            }
        }
        JSObject ret = new JSObject();
        ret.put("shoot", shoot);
        call.resolve(ret);
    }
}
