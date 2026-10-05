# ═══════════════════════════════════════════════════════════════════════════
# R8 rules for com.bloxfruitevalues (ported from adoptme-jan7, 2026-10-05)
#
# READ THIS BEFORE ADDING A `-keep`.
#
# Every `-keep class some.package.** { *; }` is a promise to R8 that it may not
# rename, inline or remove any of those classes. Play Console grades the DEX of
# each uploaded bundle and warns when obfuscation drops under 25%; release 157
# (1.15.31) scored 21%, and the reason was this file. Measured from that
# build's own mapping.txt: 21,640 of 26,687 classes kept their original names,
# and ~20,500 of those were held by blanket rules that used to live here —
# 12,712 by the single `com.google.android.gms.**` line, 2,414 by
# `com.google.firebase.**`, 1,600 by `com.facebook.react.**`, 430 by
# okhttp3/okio.
#
# (Blox Fruit's previous file had the same blanket keeps: its 4.0.12 build
# kept 79.7% of class names, 20.3% obfuscated. The old file is in git history.)
#
# None of those rules were ever needed. Every one of those libraries ships its
# own consumer ProGuard rules inside its AAR; AGP merges them automatically and
# writes the merged result to build/outputs/mapping/release/configuration.txt.
# Google's, Square's and Meta's rules are deliberately surgical (SafeParcelable
# CREATORs, proto fields, @DoNotStrip, native methods) because their SDKs are
# built to be minified. Re-adding a wholesale keep for a library that ships its
# own rules buys nothing but a worse Play grade and a bigger DEX.
#
# So: only rules the AARs do NOT cover belong below, and each one says why.
#
# Measure the obfuscation rate of a build before/after any change here:
#   awk '/^[^ \t].* -> .*:$/ { l=$0; sub(/:$/,"",l); split(l,a," -> ");
#     n=split(a[1],p,"."); m=split(a[2],q,".");
#     t++; if (p[n]!=q[m]) o++ }
#     END { printf "%d/%d obfuscated (%.1f%%)\n", o, t, 100*o/t }' \
#     app/build/outputs/mapping/release/mapping.txt
#
# And ALWAYS install + launch a release build before uploading. Removing keeps
# is the change most likely to surface a missing one, and R8 failures show up
# at runtime, never at build time.
# ═══════════════════════════════════════════════════════════════════════════

# ── Attributes ──────────────────────────────────────────────────────────────
# proguard-android-optimize.txt already keeps AnnotationDefault, EnclosingMethod,
# InnerClasses, Signature and the RuntimeVisible* sets. These two are the
# addition: without them every Crashlytics stack frame loses its file and line
# number. The Crashlytics gradle plugin uploads mapping.txt automatically, so
# the traces still deobfuscate.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── React Native / Hermes ───────────────────────────────────────────────────
# react-android's consumer rules (react-android-<ver>/proguard.txt) already
# keep: anything annotated @DoNotStrip (both the proguard and the jni variant,
# with fbcore covering com.facebook.common.internal.DoNotStrip too), every
# NativeModule and JavaScriptModule implementor, all native <methods>, every
# @ReactProp/@ReactPropGroup method, and the whole bridge + turbomodule
# packages. That is the contract RN ships for minified release builds — there
# is no blanket `com.facebook.react.**` keep here on purpose.
#
# The exception: Hermes' unicode helpers are reached from C++ via FindClass on
# a literal descriptor, which a rename would break.
-keep class com.facebook.hermes.unicode.** { *; }

-dontwarn com.facebook.react.**
-dontwarn com.facebook.hermes.**
-dontwarn com.facebook.jni.**

# ── Room / WorkManager / androidx.startup ───────────────────────────────────
# WorkManager (pulled in by notifee) starts from an androidx.startup provider
# and builds its Room database by reflectively loading WorkDatabase_Impl. Room's
# own consumer rule keeps the class but not its constructor, and AGP 9's R8 no
# longer keeps the default ctor for a class-only rule, so 1.15.40 crashed at
# launch ("Failed to create an instance of class
# androidx.work.impl.WorkDatabase.canonicalName") before any JS ran. Same fix
# as mm2values 1.4.8. Blox Fruit hit the same crash on 2026-10-01.
-keepattributes InnerClasses,EnclosingMethod,Signature,*Annotation*
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keepnames class * extends androidx.room.RoomDatabase
-keep class * implements androidx.startup.Initializer { <init>(); }

# ── Nitro modules / MMKV ────────────────────────────────────────────────────
# Nitro's generated hybrids are annotated @DoNotStrip + @Keep, so RN's rules
# would cover them, but the C++ side resolves every hybrid by literal class
# descriptor (findClassStatic("com/margelo/nitro/...")) and a single missed
# annotation on a generated file is a hard crash on first storage access.
# ~60 classes: cheap insurance, unlike the rules above it.
-keep class com.margelo.nitro.** { *; }
-keep class com.mrousavy.** { *; }

# ── AdMob mediation adapters ────────────────────────────────────────────────
# Adapters are instantiated reflectively by class name from the AdMob server
# config, so the ads SDK's own rules cannot keep them and R8 cannot see the
# reference. Keep it for any adapter added to build.gradle.
-keep class com.google.ads.mediation.** { *; }
-dontwarn com.google.ads.mediation.**

# ── Install Referrer (react-native-device-info) ─────────────────────────────
# RNInstallReferrerClient looks up InstallReferrerClient.newBuilder by
# reflection; renamed, getInstallReferrer() silently returns nothing. Rule
# from the library README.
-keep class com.android.installreferrer.api.** { *; }

# ── Warning suppression only — NO keeps ─────────────────────────────────────
# These libraries reference classes that are absent at compile time (optional
# backends, desktop-only APIs, @Nullable annotations). -dontwarn silences R8;
# it does not stop it from renaming anything.
-dontwarn com.google.android.gms.**
-dontwarn com.google.firebase.**
-dontwarn com.revenuecat.**
-dontwarn com.swmansion.**
-dontwarn com.airbnb.lottie.**
-dontwarn com.horcrux.svg.**
-dontwarn com.oblador.**
-dontwarn com.reactnativecompressor.**
-dontwarn com.zoontek.**
-dontwarn io.invertase.**
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn com.reactnativegooglesignin.**
-dontwarn com.RNAppleAuthentication.**
-dontwarn com.BV.LinearGradient.**
-dontwarn com.imagepicker.**
-dontwarn com.rnfs.**
-dontwarn cl.json.**
-dontwarn fr.greweb.reactnativeviewshot.**
-dontwarn com.reactnativecommunity.**
-dontwarn com.learnium.RNDeviceInfo.**
-dontwarn com.mkuczera.**
-dontwarn com.reactnativetrackingtransparency.**
