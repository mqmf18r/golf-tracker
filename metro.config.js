const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// `react-native-maps` has no web target — importing it crashes the entire
// web bundle at boot (not just map screens), since Metro's dev web build
// eagerly evaluates every route. Redirect it to a harmless stub ONLY on
// web; iOS/Android keep resolving the real native package untouched.
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform, ...rest) => {
  if (moduleName === 'react-native-maps' && platform === 'web') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/web-stubs/react-native-maps.tsx'),
    };
  }
  // expo-camera's web build only reaches this via a dynamic import() inside
  // its barcode-scanner path (unused by ShotVision) — see the stub file for
  // why the real package doesn't resolve under this project's Metro.
  if (moduleName === 'barcode-detector' && platform === 'web') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/web-stubs/barcode-detector.ts'),
    };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform, ...rest);
  }
  return context.resolveRequest(context, moduleName, platform, ...rest);
};

module.exports = config;
