import { Platform } from "react-native";

const isNoman = false; // Toggle this to switch configurations

// noman app id = ca-app-pub-5740215782746766~2003215297 
//waqas app id = ca-app-pub-3701208411582706~6049471125

// noman pkgName= com.growagarden.gag
//waqas pkgName = com.stocknotifier.gag

// npx icon-set-creator create ./assets/icon.png                                              

                                                                           
// npx react-native-bootsplash generate ./assets/icon.png \
//   --platforms=android,ios \
//   --background=FFFFFF \
//   --logo-width=160

// cd android                                                                                      
// ./gradlew --stop
// ./gradlew clean
// rm -rf app/build build
// cd ..
// npx react-native run-android

const rev_cat_id = Platform.OS === 'ios' ? 'appl_EYTCVKCRICllCBhSNlffYgsgSqw' : 'goog_XsLCbrZoWWDgEwfILSZifwEdyoq'

const config = {
<<<<<<< HEAD
  appName: isNoman ? 'Grow a Garden Values' : 'Blox Fruit Stock',
  andriodBanner: isNoman ? 'ca-app-pub-5740215782746766/1868318076' : 'ca-app-pub-3701208411582706/4273903768',
  andriodIntestial: isNoman ? 'ca-app-pub-5740215782746766/3750592995' : 'ca-app-pub-3701208411582706/1399779677',
  andriodRewarded: isNoman ? 'ca-app-pub-5740215782746766/6929073068' : 'ca-app-pub-3701208411582706/7718324752',
  andriodOpenApp: isNoman ? 'ca-app-pub-5740215782746766/2437511324' : 'ca-app-pub-3701208411582706/6209253223',
  andriodNative: isNoman ? 'ca-app-pub-5740215782746766/2941106105' : 'ca-app-pub-3701208411582706/6460534663',
  IOsIntestial: isNoman ? 'ca-app-pub-5740215782746766/7915416328' : '',
  IOsBanner: isNoman ? 'ca-app-pub-5740215782746766/7687351460' : '',
  IOsRewarded: isNoman ? 'ca-app-pub-5740215782746766/7498266315' : '',
  IOsOpenApp: isNoman ? 'ca-app-pub-5740215782746766/2989828057' : '',
  IOsNative: isNoman ? '' : '',
=======
  appName: isNoman ? 'Blox Fruit Values Calc' : 'Blox Fruit Stock',
  andriodBanner: isNoman ? 'ca-app-pub-5740215782746766/5225162749' : 'ca-app-pub-3701208411582706/4133745803',
  andriodIntestial: isNoman ? 'ca-app-pub-5740215782746766/1206026687' : 'ca-app-pub-3701208411582706/2820664136',
  andriodRewarded: isNoman ? 'ca-app-pub-5740215782746766/6313459657' : 'ca-app-pub-3701208411582706/5175818984',
  andriodRewarded_int: isNoman ? 'ca-app-pub-5740215782746766/7546285622' : 'ca-app-pub-3701208411582706/5175818984',
  andriodOpenApp: isNoman ? 'ca-app-pub-5740215782746766/9015676434' : 'ca-app-pub-3701208411582706/2295931822',
  andriodNative: isNoman ? 'ca-app-pub-5740215782746766/2941106105' : 'ca-app-pub-3701208411582706/5457520430',
  IOsIntestial: isNoman ? 'ca-app-pub-5740215782746766/3209373499' : '',
  IOsBanner: isNoman ? 'ca-app-pub-5740215782746766/4522455164' : '',
  IOsRewarded: isNoman ? 'ca-app-pub-5740215782746766/9755679519' : '',
  IOsOpenApp: isNoman ? 'ca-app-pub-5740215782746766/1499878996' : '',
  IOsNative: isNoman ? 'ca-app-pub-5740215782746766/8838394066' : '',
  andriodRewarded_int_ios:isNoman ? 'ca-app-pub-5740215782746766/8838394066' : '',
>>>>>>> f99f5c4 (hh)

  apiKey: isNoman ? rev_cat_id : 'goog_OvpCwHeXQfAoldFagQLRenbvtiO',

  supportEmail: isNoman ? 'thesolanalabs@gmail.com' : 'mindfusionio.help@gmail.com',
  andriodShareLink: isNoman ? 'https://play.google.com/store/apps/details?id=com.growagarden.gag' : 'https://play.google.com/store/apps/details?id=com.stocknotifier.gag',
  IOsShareLink: isNoman ? 'https://apps.apple.com/us/app/app-name/id6747990898' : '',
  IOsShareLink: isNoman ? 'https://apps.apple.com/us/app/app-name/id6747990898' : '',
  webSite: isNoman ? 'https://grow-a-garden.app/' : 'https://bloxfruitvalue.today',

  isNoman: isNoman ? true : false,


  colors: isNoman
    ? {
      primary: '#6320EE', // Muted grayish blue
      secondary: '#3E8BFC', // Bright action blue
      hasBlockGreen: '#6320EE', // Vibrant success green
      wantBlockRed: '#211A1D', // Vivid warning red
      backgroundLight: '#f2f2f7',
      backgroundDark: '#121212',
      white:'white',
      black:'black'
    }
    : {
      primary: '#8F87F1', // Deep navy blue
      secondary: '#8F87F1', // Muted teal
      hasBlockGreen: '#8F87F1', // Light mint green
      wantBlockRed: '#ff4d6d', // Warm, soft red
      backgroundLight: '#f2f2f7',
      backgroundDark: '#121212',
       white:'white',
      black:'black'
    },

};

export default config;
