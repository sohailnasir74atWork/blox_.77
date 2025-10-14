<<<<<<< HEAD:android/app/src/main/java/com/bloxfruitevalues/MainActivity.kt
package com.stocknotifier.gag
=======
package com.bloxfruitstock
>>>>>>> 8b44f57 (new app changes):android/app/src/main/java/com/bloxfruitstock/MainActivity.kt

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.zoontek.rnbootsplash.RNBootSplash
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    override fun getMainComponentName(): String = "bloxfruitevalues"

    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        RNBootSplash.init(this, R.style.BootTheme); 
        super.onCreate(null); 
    }
}
