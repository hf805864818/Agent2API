package com.agent2api.mobile;

import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;
import android.util.Log;

/**
 * 下拉状态栏的 Quick Settings 磁贴：一键开 / 停「网关连接」。
 *
 * 状态来自 GatewayKeepAliveService 的进程内标志，副标题显示最后连接的网关地址。
 * 这是从「AI 聚合网关」GatewayTileService 借来的交互 —— 用户不用打开 App 就能
 * 看连接在不在、点一下就能切。
 */
public class GatewayTileService extends TileService {

    @Override
    public void onStartListening() {
        super.onStartListening();
        updateTile();
    }

    private void updateTile() {
        Tile tile = getQsTile();
        if (tile == null) return;
        boolean on = GatewayKeepAliveService.isRunning();
        tile.setState(on ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        String subtitle = on ? "连接中" : "未连接";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle(subtitle);
            tile.setLabel("Agent2API");
        } else {
            tile.setLabel(on ? "网关 · 连接中" : "网关 · 未连接");
        }
        tile.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        try {
            if (GatewayKeepAliveService.isRunning()) {
                getSharedPreferences(GatewayBootReceiver.PREF_NAME, MODE_PRIVATE)
                        .edit().putBoolean(KeepAlivePlugin.PREF_WANT, false).apply();
                stopService(new Intent(this, GatewayKeepAliveService.class));
                Log.i(GatewayKeepAliveService.TAG, "磁贴停止了网关连接");
            } else {
                getSharedPreferences(GatewayBootReceiver.PREF_NAME, MODE_PRIVATE)
                        .edit().putBoolean(KeepAlivePlugin.PREF_WANT, true).apply();
                Intent service = new Intent(this, GatewayKeepAliveService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(service);
                } else {
                    startService(service);
                }
                Log.i(GatewayKeepAliveService.TAG, "磁贴启动了网关连接");
            }
        } catch (Exception e) {
            Log.w(GatewayKeepAliveService.TAG, "磁贴操作失败：" + e.getMessage());
        }
        updateTile();
    }
}
