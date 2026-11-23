package com.agent2api.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * 开机 / 应用更新后自愈：重启保活服务。
 *
 * 参考「AI 聚合网关」GatewayBootReceiver 的做法，但默认关闭 —— 因为我们的网关
 * 在电脑上，手机开机时电脑未必在线，盲目拉起只会弹一个连不上的通知。只有用户在
 * 设置里明确打开「开机自动连接」才注册这个行为（开关写在 SharedPreferences）。
 */
public class GatewayBootReceiver extends BroadcastReceiver {

    public static final String PREF_NAME = "a2a_keepalive";
    public static final String PREF_START_ON_BOOT = "start_on_boot";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        boolean boot = Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action);
        if (!boot) return;

        boolean want = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
                .getBoolean(PREF_START_ON_BOOT, false);
        if (!want) return;

        try {
            Intent service = new Intent(context, GatewayKeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(service);
            } else {
                context.startService(service);
            }
            Log.i(GatewayKeepAliveService.TAG, "开机自启保活服务");
        } catch (Exception e) {
            Log.w(GatewayKeepAliveService.TAG, "开机自启失败：" + e.getMessage());
        }
    }
}
