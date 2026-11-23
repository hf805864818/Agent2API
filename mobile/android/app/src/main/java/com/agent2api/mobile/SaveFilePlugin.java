package com.agent2api.mobile;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 把一段文本写成文件，落到用户能找到的位置（「下载」目录）。
 *
 * ── 为什么不引 @capacitor/filesystem ─────────────────────────
 * 只用得到一个能力：写一个文本文件。为此拉一整个插件包，构建链要多一份原生依赖，
 * 而这份产物要长期跟着 APK 走。这个类 60 行解决同一件事，且行为完全可控。
 *
 * ── 为什么分两条路径 ─────────────────────────────────────────
 * Android 10（API 29）起强制分区存储，往公共目录直接写文件会失败。所以：
 *   · API ≥ 29：走 MediaStore.Downloads 插入，系统接管落盘，不需要任何权限；
 *   · API < 29：只能写外部存储，需要 WRITE_EXTERNAL_STORAGE（已在 Manifest 声明
 *     且 maxSdkVersion=28，29+ 不会申请）。
 * 两条路径都不弹运行时权限框 —— 导出这种动作不该先拦住用户。
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename", "");
        String content = call.getString("content", "");
        String mime = call.getString("mime", "application/json");
        if (filename.trim().isEmpty()) {
            call.reject("缺少文件名");
            return;
        }
        if (content == null) content = "";

        try {
            String location;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                location = saveViaMediaStore(filename, content, mime);
            } else {
                location = saveViaFile(filename, content);
            }
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("path", location);
            result.put("filename", filename);
            result.put("bytes", content.getBytes(StandardCharsets.UTF_8).length);
            call.resolve(result);
        } catch (Throwable error) {
            // 失败原因原样回给前端：磁盘满、目录不可写、同名冲突等都可能发生，
            // 让用户看到真实原因比一句「保存失败」有用。
            call.reject("保存失败：" + error.getMessage());
        }
    }

    /** API 29+：MediaStore 插入到 Downloads，无需权限。 */
    private String saveViaMediaStore(String filename, String content, String mime) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        values.put(MediaStore.Downloads.MIME_TYPE, mime);
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IllegalStateException("系统没有返回可写位置");

        try (OutputStream stream = resolver.openOutputStream(uri)) {
            if (stream == null) throw new IllegalStateException("无法打开输出流");
            stream.write(content.getBytes(StandardCharsets.UTF_8));
            stream.flush();
        } catch (Exception error) {
            // 写失败要把占位记录删掉，否则 Downloads 里会留一条空文件
            try { resolver.delete(uri, null, null); } catch (Throwable ignored) { }
            throw error;
        }

        ContentValues done = new ContentValues();
        done.put(MediaStore.Downloads.IS_PENDING, 0);
        resolver.update(uri, done, null, null);
        return "下载/" + filename;
    }

    /** API < 29：直接写公共 Downloads 目录。 */
    private String saveViaFile(String filename, String content) throws Exception {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("下载目录不可用");
        }
        File target = new File(dir, filename);
        try (FileOutputStream stream = new FileOutputStream(target)) {
            stream.write(content.getBytes(StandardCharsets.UTF_8));
            stream.flush();
        }
        return target.getAbsolutePath();
    }
}
