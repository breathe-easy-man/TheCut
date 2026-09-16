package com.kevins.thecut;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.widget.RemoteViews;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Renders the blob WidgetBridge stores. Three bars — fat loss, calories, protein — and a button
 * that opens the app straight into the camera.
 */
public class CutWidget extends AppWidgetProvider {

    static final String EXTRA_SHOOT = "com.kevins.thecut.SHOOT";

    private static final int[] LABELS = { R.id.w_label0, R.id.w_label1, R.id.w_label2 };
    private static final int[] VALUES = { R.id.w_value0, R.id.w_value1, R.id.w_value2 };
    private static final int[] BARS   = { R.id.w_bar0,   R.id.w_bar1,   R.id.w_bar2   };
    private static final String[] FALLBACK = { "FAT LOST", "CALORIES", "PROTEIN" };

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.cut_widget);

        JSONArray bars = null;
        try {
            bars = new JSONObject(WidgetBridge.readState(ctx)).optJSONArray("bars");
        } catch (Exception e) {
            /* Never rendered from a half-written or absent blob — fall through to the empty state. */
        }

        for (int i = 0; i < LABELS.length; i++) {
            JSONObject b = (bars == null) ? null : bars.optJSONObject(i);
            if (b == null) {
                v.setTextViewText(LABELS[i], FALLBACK[i]);
                v.setTextViewText(VALUES[i], "—");
                v.setProgressBar(BARS[i], 100, 0, false);
                v.setTextColor(VALUES[i], ContextCompat.getColor(ctx, R.color.w_muted));
                continue;
            }
            int pct = Math.max(0, Math.min(100, b.optInt("pct", 0)));
            v.setTextViewText(LABELS[i], b.optString("label", FALLBACK[i]));
            v.setTextViewText(VALUES[i], b.optString("value", "—"));
            v.setProgressBar(BARS[i], 100, pct, false);
            /* Resolved against the app's resources rather than the launcher's. The two agree
               because the app never overrides uiMode — it follows the system setting, same as
               the launcher does. Everything else here is a resource the launcher resolves. */
            v.setTextColor(VALUES[i], ContextCompat.getColor(ctx,
                    b.optBoolean("over", false) ? R.color.w_over : R.color.w_text));
        }

        v.setOnClickPendingIntent(R.id.w_add,  launch(ctx, true));
        v.setOnClickPendingIntent(R.id.w_root, launch(ctx, false));
        return v;
    }

    /* Distinct request codes, because PendingIntent equality ignores extras: share one and the
       second registration would quietly rewrite the first, and both taps would do the same thing. */
    private static PendingIntent launch(Context ctx, boolean shoot) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (shoot) i.putExtra(EXTRA_SHOOT, true);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, shoot ? 1 : 0, i, flags);
    }

    static void refresh(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, CutWidget.class))) {
            mgr.updateAppWidget(id, build(ctx));
        }
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }
}
