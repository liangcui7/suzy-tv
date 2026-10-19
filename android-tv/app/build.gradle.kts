plugins {
    id("com.android.application")
}

val suzyTvUrl = providers.gradleProperty("suzyTvUrl").orNull
    ?: "https://example.com/"
require(suzyTvUrl.startsWith("https://") && suzyTvUrl.none { it == '"' || it == '\\' || it.isISOControl() }) {
    "Set -PsuzyTvUrl=https://your-suzy-tv-domain/ to the hosted Suzy TV address."
}

android {
    namespace = "tv.suzy.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "tv.suzy.app"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "START_URL", "\"$suzyTvUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
