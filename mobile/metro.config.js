// Metro config: NativeWind, plus the repo's shared/ folder (constants used by web, server and app).
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Only shared/ is bundled from outside mobile/. Server code is imported as types only.
config.watchFolders = [path.join(repoRoot, "shared")];
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules")];
config.resolver.extraNodeModules = { "@shared": path.join(repoRoot, "shared") };

module.exports = withNativeWind(config, { input: "./src/global.css" });
