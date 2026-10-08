const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const exampleModules = path.resolve(projectRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

const SINGLETONS = ['react', 'react-native', 'scheduler', 'expo-file-system'];

config.resolver.extraNodeModules = Object.fromEntries(
  SINGLETONS.map((name) => [name, path.resolve(exampleModules, name)]).concat([
    ['expo-audio-cache', workspaceRoot],
  ])
);

config.resolver.nodeModulesPaths = [exampleModules];

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (SINGLETONS.includes(moduleName)) {
    const target = path.resolve(exampleModules, moduleName);
    if (fs.existsSync(target)) {
      return context.resolveRequest(context, target, platform);
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
