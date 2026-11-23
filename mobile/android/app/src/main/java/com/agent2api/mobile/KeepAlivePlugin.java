package com.agent2api.mobile;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS ↔ 原生保活桥。暴露四个方法：
 *   start({server})  启动前台服务并记录目标网关
 *   stop()           停止服务
 *   status()         查询当前是否在保活
 *   setStartOnBoot({enabled})  开机自启开关（写 SharedPreferences）
 */
@CapacitorPlugin(name = "KeepAlive")
public class KeepAlivePlugin extends Plugin {

    public static final String PREF_WANT = "want_running";
    static final String PREF_SERVER = "server";

    static boolean wantRunning(android.content.Context context) {
        return context.getSharedPreferences(GatewayBootReceiver.PREF_NAME, android.content.Context.MODE_PRIVATE)
                .getBoolean(PREF_WANT, false);
    }

    static String savedServer(android.content.Context context) {
        return context.getSharedPreferences(GatewayBootReceiver.PREF_NAME, android.content.Context.MODE_PRIVATE)
                .getString(PREF_SERVER, "");
    }

    @PluginMethod
    public void start(PluginCall call) {
        String server = call.getString("server", "");
        GatewayKeepAliveService.setLastServer(server);
        getContext().getSharedPreferences(GatewayBootReceiver.PREF_NAME, Context.MODE_PRIVATE)
                .edit().putBoolean(PREF_WANT, true).putString(PREF_SERVER, server).apply();
        Intent intent = new Intent(getContext(), GatewayKeepAliveService.class);
        intent.putExtra("server", server);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            JSObject result = new JSObject();
            result.put("running", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("启动保活失败：" + error.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().getSharedPreferences(GatewayBootReceiver.PREF_NAME, Context.MODE_PRIVATE)
                .edit().putBoolean(PREF_WANT, false).apply();
        getContext().stopService(new Intent(getContext(), GatewayKeepAliveService.class));
        JSObject result = new JSObject();
        result.put("running", false);
        call.resolve(result);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        // 以「用户意愿」为准：服务可能刚被系统回收、或还没来得反启动，
        // 但开关该显示用户上次的选择，而不是闪一下又变回关。
        result.put("running", GatewayKeepAliveService.isRunning() || wantRunning(getContext()));
        result.put("server", savedServer(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void setStartOnBoot(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        getContext().getSharedPreferences(GatewayBootReceiver.PREF_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(GatewayBootReceiver.PREF_START_ON_BOOT, enabled)
                .apply();
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    @PluginMethod
    public void getStartOnBoot(PluginCall call) {
        boolean enabled = getContext().getSharedPreferences(GatewayBootReceiver.PREF_NAME, Context.MODE_PRIVATE)
                .getBoolean(GatewayBootReceiver.PREF_START_ON_BOOT, false);
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }
}
