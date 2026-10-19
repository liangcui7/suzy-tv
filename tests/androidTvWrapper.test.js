import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

describe("Android TV wrapper", () => {
  it("declares a leanback launcher APK for Suzy TV", async () => {
    const manifest = await readProjectFile("android-tv/app/src/main/AndroidManifest.xml");
    const strings = await readProjectFile("android-tv/app/src/main/res/values/strings.xml");

    expect(strings).toContain("<string name=\"app_name\">Suzy TV</string>");
    expect(manifest).toContain("<uses-permission android:name=\"android.permission.INTERNET\" />");
    expect(manifest).toContain("android:name=\"android.software.leanback\"");
    expect(manifest).toContain("android:name=\"android.hardware.touchscreen\"");
    expect(manifest).toContain("android:label=\"@string/app_name\"");
    expect(manifest).toContain("android:icon=\"@drawable/logo_family\"");
    expect(manifest).toContain("android:banner=\"@drawable/tv_banner\"");
    expect(manifest).toContain("android.intent.category.LEANBACK_LAUNCHER");
  });

  it("loads the hosted PWA with WebView settings needed for YouTube and remote focus", async () => {
    const activity = await readProjectFile("android-tv/app/src/main/java/tv/suzy/app/MainActivity.java");

    expect(activity).toContain("BuildConfig.START_URL");
    const buildConfig = await readProjectFile("android-tv/app/build.gradle.kts");
    expect(buildConfig).toContain('gradleProperty("suzyTvUrl")');
    expect(activity).toContain("setJavaScriptEnabled(true)");
    expect(activity).toContain("setDomStorageEnabled(true)");
    expect(activity).toContain("setMediaPlaybackRequiresUserGesture(false)");
    expect(activity).toContain("setAcceptThirdPartyCookies(webView, true)");
    expect(activity).toContain("webView.requestFocus()");
    expect(activity).toContain("KEYCODE_DPAD_CENTER");
    expect(activity).toContain("KEYCODE_BUTTON_A");
    expect(activity).toContain("KEYCODE_BUTTON_SELECT");
    expect(activity).toContain("clickActivePageElement()");
    expect(activity).toContain("evaluateJavascript");
    expect(activity).toContain("canGoBack()");
  });
});
