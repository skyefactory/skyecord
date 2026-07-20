const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: `./favicon`,
    executableName: 'skyecord',
    win32metadata: {
      CompanyName: 'skyefactory',
      FileDescription: 'skyecord',
      ProductName: 'skyecord',
      InternalName: 'skyecord',
    },
    extraResource:[
      "./client"
    ],


  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'skyecord',
        iconUrl: 'https://skyecord.skyefactory.com/favicon.ico',
        setupIcon: './favicon.ico',
        loadingGif: './loading-gif.gif',
      },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        icon: './512.png'
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'skyefactory',
          name: 'skyecord'
        },
        prerelease: false,
        draft: true // Creates a draft release you can review before turning public
      }
    }
  ]
};
