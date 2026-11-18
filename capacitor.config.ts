import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pixelatelier.console',
  appName: 'Pixel Atelier',
  webDir: 'dist',
  backgroundColor: '#f5efe6',
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  ios: {
    contentInset: 'never',
    allowsLinkPreview: false,
    scrollEnabled: false,
    preferredContentMode: 'mobile',
  },
  android: {
    backgroundColor: '#f5efe6',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 450,
      launchAutoHide: false,
      backgroundColor: '#f5efe6',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#f5efe6',
      overlaysWebView: true,
    },
  },
};

export default config;
