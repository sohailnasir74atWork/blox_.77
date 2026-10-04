# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in proguard-android-optimize.txt (see proguardFiles in app/build.gradle).
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ---- React Native core ----
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.react.** { *; }
-keep class com.facebook.react.bridge.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-keepclassmembers class * {
    native <methods>;
}
-dontwarn com.facebook.react.**
-dontwarn com.facebook.hermes.**
-dontwarn com.facebook.jni.**

# ---- Attributes needed by reflection / JSON / Crashlytics ----
-keepattributes *Annotation*
-keepattributes JavascriptInterface
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ---- App package ----
-keep class com.bloxfruitevalues.** { *; }

# ---- Reanimated / Worklets / Gesture Handler / Screens ----
-keep class com.swmansion.reanimated.** { *; }
-dontwarn com.swmansion.reanimated.**
-keep class com.swmansion.worklets.** { *; }
-dontwarn com.swmansion.worklets.**
-keep class com.swmansion.gesturehandler.** { *; }
-dontwarn com.swmansion.gesturehandler.**
-keep class com.swmansion.rnscreens.** { *; }
-dontwarn com.swmansion.rnscreens.**

# ---- Nitro modules (react-native-nitro-modules, react-native-mmkv v4) ----
-keep class com.margelo.** { *; }
-dontwarn com.margelo.**

# ---- Firebase ----
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
-keep class io.invertase.firebase.** { *; }
-dontwarn io.invertase.firebase.**

# ---- Google Play services ----
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**
-keep class com.google.android.gms.ads.** { *; }
-dontwarn com.google.android.gms.ads.**
-keep class com.google.android.gms.auth.** { *; }
-dontwarn com.google.android.gms.auth.**

# ---- AdMob (RN bridge) + UMP ----
-keep class io.invertase.googlemobileads.** { *; }
-dontwarn io.invertase.googlemobileads.**
-keep class com.google.android.ump.** { *; }
-dontwarn com.google.android.ump.**

# ---- Play Core (in-app updates / in-app review) ----
-keep class com.google.android.play.** { *; }
-dontwarn com.google.android.play.**

# ---- RevenueCat ----
-keep class com.revenuecat.** { *; }
-dontwarn com.revenuecat.**

# ---- Notifee ----
-keep class io.invertase.notifee.** { *; }
-dontwarn io.invertase.notifee.**

# ---- Google Sign-In / Apple Authentication ----
-keep class com.reactnativegooglesignin.** { *; }
-dontwarn com.reactnativegooglesignin.**
-keep class com.RNAppleAuthentication.** { *; }
-dontwarn com.RNAppleAuthentication.**

# ---- Lottie ----
-keep class com.airbnb.lottie.** { *; }
-dontwarn com.airbnb.lottie.**

# ---- SVG / vector icons / linear gradient ----
-keep class com.horcrux.svg.** { *; }
-dontwarn com.horcrux.svg.**
-keep class com.oblador.vectoricons.** { *; }
-dontwarn com.oblador.vectoricons.**
-keep class com.BV.LinearGradient.** { *; }
-dontwarn com.BV.LinearGradient.**

# ---- zoontek modules (bootsplash, localize, permissions) ----
-keep class com.zoontek.** { *; }
-dontwarn com.zoontek.**

# ---- Keychain ----
-keep class com.oblador.keychain.** { *; }
-dontwarn com.oblador.keychain.**

# ---- Media / files / sharing ----
-keep class com.reactnativecompressor.** { *; }
-dontwarn com.reactnativecompressor.**
-keep class com.imagepicker.** { *; }
-dontwarn com.imagepicker.**
-keep class com.rnfs.** { *; }
-dontwarn com.rnfs.**
-keep class cl.json.** { *; }
-dontwarn cl.json.**
-keep class fr.greweb.reactnativeviewshot.** { *; }
-dontwarn fr.greweb.reactnativeviewshot.**
-keep class com.reactnativecommunity.** { *; }
-dontwarn com.reactnativecommunity.**

# ---- Device info / haptics / tracking transparency ----
-keep class com.learnium.RNDeviceInfo.** { *; }
-dontwarn com.learnium.RNDeviceInfo.**
-keep class com.mkuczera.** { *; }
-dontwarn com.mkuczera.**
-keep class com.reactnativetrackingtransparency.** { *; }
-dontwarn com.reactnativetrackingtransparency.**

# ---- Networking (OkHttp / Okio) ----
-keep class okhttp3.** { *; }
-dontwarn okhttp3.**
-keep class okio.** { *; }
-dontwarn okio.**

# ---- Room / WorkManager / androidx.startup ----
# WorkManager (pulled in by notifee) starts from an androidx.startup provider
# and builds its Room database by reflectively loading WorkDatabase_Impl. Room's
# own consumer rule keeps the class but not its constructor, and AGP 9's R8 no
# longer keeps the default ctor for a class-only rule, so the first release
# build after the RN 0.87 / AGP 9 upgrade crashed at launch ("Failed to create
# an instance of class androidx.work.impl.WorkDatabase.canonicalName") before
# any JS ran (found 2026-10-01). Same fix as mm2values 1.4.8 and adoptme 1.15.41.
-keepattributes InnerClasses,EnclosingMethod,Signature,*Annotation*
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keepnames class * extends androidx.room.RoomDatabase
-keep class * implements androidx.startup.Initializer { <init>(); }
