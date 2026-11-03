# LiteRT finds its runtime by class name (InterpreterFactoryImpl) and calls
# into Java from native code: keep it as is in release (R8) builds.
-keep class org.tensorflow.lite.** { *; }
-keep class com.google.ai.edge.litert.** { *; }
