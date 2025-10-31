import { Platform } from "react-native";

const isNoman = false; // Toggle this to switch configurations

// noman app id = ca-app-pub-5740215782746766~2511096424
//waqas app id = ca-app-pub-3701208411582706~4267174419
// noman pkgName= com.bloxfruitevalues
//waqas pkgName = com.bloxfruitstock
const rev_cat_id = Platform.OS === 'ios' ? 'appl_QKRWvOpeEbPWTIEzrRZScJuJDtz' : 'goog_vbOdGmvwsPRXPVNHgrVHiCRtnez'

const config = {
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

  apiKey: isNoman ? rev_cat_id : 'goog_hNbzYuzixIbRtuJzgHltVeZzYos',

  supportEmail: isNoman ? 'thesolanalabs@gmail.com' : 'mindfusionio.help@gmail.com',
  andriodShareLink: isNoman ? 'https://play.google.com/store/apps/details?id=com.bloxfruitevalues' : 'https://play.google.com/store/apps/details?id=com.bloxfruitstock',
  IOsShareLink: isNoman ? 'https://apps.apple.com/us/app/app-name/id6737775801' : '',
  IOsShareLink: isNoman ? 'https://apps.apple.com/us/app/app-name/id6737775801' : '',
  webSite: isNoman ? 'https://bloxfruitscalc.com/' : 'https://bloxfruitvalue.today',

  isNoman: isNoman ? true : false,

otherapplink: Platform.OS == 'android' ? 'https://play.google.com/store/apps/details?id=com.adoptmevaluescalc' : 'https://apps.apple.com/us/app/adoptme-values/id6745400111',
otherapplink2: Platform.OS == 'android' ? 'https://play.google.com/store/apps/details?id=com.mm2tradesvalues' : 'https://apps.apple.com/us/app/adoptme-values/id6745400111',
  colors: isNoman
    ? {
      primary: '#6A5ACD', // Muted grayish blue
      secondary: '#3E8BFC', // Bright action blue
      hasBlockGreen: '#29AB87', // Vibrant success green
      wantBlockRed: '#FF3B30', // Vivid warning red
      backgroundLight: '#f2f2f7',
      backgroundDark: '#121212',
      white:'white',
      black:'black'
    }
    : {
      primary: '#697565', // Deep navy blue
      secondary: '#457B9D', // Muted teal
      hasBlockGreen: '#B8860B', // Light mint green
      wantBlockRed: '#E63946', // Warm, soft red
      backgroundLight: '#f2f2f7',
      backgroundDark: '#121212',
       white:'white',
      black:'black'
    },

};

export default config;
