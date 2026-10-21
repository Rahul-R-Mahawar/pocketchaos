const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Use Metro's Node crawler: a broken Watchman install would otherwise break bundling.
config.resolver.useWatchman = false;

module.exports = config;
