package com.agent2api.mobile;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 自定义插件必须在 super.onCreate 之前注册：BridgeActivity 在那里
        // 就把插件表建好了（见 BridgeActivity.load()）。
        registerPlugin(ApkUpdaterPlugin.class);
        registerPlugin(ImageSaverPlugin.class);
        registerPlugin(KeepAlivePlugin.class);
        registerPlugin(SaveFilePlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onPostResume() {
        super.onPostResume();
        // BridgeActivity 的 onResume 是 final，只能挂 onPostResume。\n        // 用户上次开着保活就继续开：系统回收服务后回到 App 自动补上，
        // 不用再手动点一次（对应 AI 聚合网关的 keepalive/want_running）。
        if (KeepAlivePlugin.wantRunning(this) && !GatewayKeepAliveService.isRunning()) {
            try {
                android.content.Intent intent = new android.content.Intent(this, GatewayKeepAliveService.class);
                intent.putExtra("server", KeepAlivePlugin.savedServer(this));
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    startForegroundService(intent);
                } else {
                    startService(intent);
                }
            } catch (Throwable ignored) {
            }
        }
    }
}
