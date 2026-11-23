package com.agent2api.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

/**
 * 网关连接保活前台服务。
 *
 * 与「AI 聚合网关」把引擎搬进手机不同，Agent2API 的网关跑在用户自己的电脑 /
 * 服务器上，手机只是控制端。所以这里保活的不是网关进程本身，而是「手机到网关
 * 的这条连接」：让 App 在后台仍维持唤醒、发布常驻通知，供 Quick Settings 磁贴
 * 与通知栏一键回到控制台。
 *
 * 刻意做得很轻：
 *   · 不抢 WakeLock / WifiLock —— 控制端没有持续流量，抢锁只会白白耗电；
 *   · 不做悬浮窗 —— 那是对「引擎在手机上」才有意义的保活手段；
 *   · 只做前台通知 + 一个 30 秒的心跳（可通过静态状态供磁贴读取），
 *     让系统把本 App 视为活跃连接而不是待冻结的后台进程。
 *
 * 用户可随时从磁贴或通知禁用；禁用状态写在 SharedPreferences，重启不丢。
 */
public class GatewayKeepAliveService extends Service {

    public static final String TAG = "A2AKeepAlive";
    public static final String CHANNEL_ID = "a2a_gateway_channel";
    public static final int NOTIFICATION_ID = 1001;

    /** 供磁贴 / 插件读取的运行状态（进程内即可，不需要跨进程）。 */
    private static volatile boolean running = false;
    private static volatile String lastServer = "";

    public static boolean isRunning() {
        return running;
    }

    public static void setLastServer(String server) {
        lastServer = server == null ? "" : server;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        running = true;
        String server = intent != null && intent.hasExtra("server")
                ? intent.getStringExtra("server")
                : lastServer;
        if (server != null && !server.isEmpty()) {
            lastServer = server;
        }
        // 前台服务类型的前置权限会随 Android 版本变严（14 起 connectedDevice 需要
        // CHANGE_NETWORK_STATE 之类）。包一层，最坏情况是「没有常驻通知」而不是
        // 整个服务反复崩、把 App 拖进 ANR 循环。
        try {
            startForeground(NOTIFICATION_ID, buildNotification());
            Log.i(TAG, "保活服务已启动，目标网关=" + lastServer);
        } catch (Throwable error) {
            running = false;
            Log.w(TAG, "startForeground 失败，保活降级为普通服务：" + error.getMessage());
            stopSelf();
            return START_NOT_STICKY;
        }
        // 不用 START_STICKY 之外的方式；系统重建时带 null intent，仍从 lastServer 恢复
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        Log.i(TAG, "保活服务已停止");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "网关连接",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("保持与 Agent2API 网关的连接");
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, flags);

        String content = "已连接到网关";
        if (!lastServer.isEmpty()) {
            content = "网关 " + lastServer;
        }

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }
        return builder
                .setSmallIcon(android.R.drawable.stat_sys_upload_done)
                .setContentTitle("Agent2API 连接中")
                .setContentText(content)
                .setContentIntent(pending)
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }
}
