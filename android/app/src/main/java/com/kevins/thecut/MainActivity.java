package com.kevins.thecut;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridge.class);
        registerPlugin(StepCounter.class);
        super.onCreate(savedInstanceState);
    }

    /* launchMode is singleTask, so a widget tap on an already-running app lands here rather than
       in onCreate. Without swapping the stored Intent, WidgetBridge.consumeAction() would keep
       reading the one the app was first opened with and the camera would never fire. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
    }
}
