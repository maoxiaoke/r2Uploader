const releaseBuild = process.env.RELEASE_BUILD === "true";

if (releaseBuild && process.platform === "darwin") {
  const missing = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID", "CSC_LINK", "CSC_KEY_PASSWORD"]
    .filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Release build is missing macOS signing/notarization secrets: ${missing.join(", ")}`);
}

if (releaseBuild && process.platform === "win32") {
  const missing = ["CSC_LINK", "CSC_KEY_PASSWORD"].filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Release build is missing Windows signing secrets: ${missing.join(", ")}`);
}

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.zuyujiao.R2Uploader",
  productName: "R2Uploader",
  copyright: "Copyright © 2026 nazha",
  directories: { output: "dist", buildResources: "resources" },
  files: [{ from: ".", filter: ["package.json", "app"] }],
  extraResources: [
    { from: "resources/icon.icns", to: "icon.icns" },
    { from: "resources/icon.ico", to: "icon.ico" },
    { from: "resources/icon.svg", to: "icon.svg" },
    { from: "cli/r2uploader-cli.mjs", to: "cli/r2uploader-cli.mjs" },
  ],
  protocols: [{ name: "R2Uploader upload request", schemes: ["r2uploader"] }],
  publish: { provider: "github", owner: "maoxiaoke", repo: "r2Uploader" },
  asar: true,
  asarUnpack: [
    "**/node_modules/sharp/**/*",
    "**/node_modules/@img/**/*",
  ],
  compression: "maximum",
  mac: {
    target: [
      { target: "dmg", arch: ["x64", "arm64"] },
      { target: "zip", arch: ["x64", "arm64"] },
    ],
    artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
    category: "public.app-category.developer-tools",
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    forceCodeSigning: releaseBuild,
    notarize: process.env.APPLE_TEAM_ID ? { teamId: process.env.APPLE_TEAM_ID } : false,
    publish: [{ provider: "github", releaseType: "release" }],
  },
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
    forceCodeSigning: releaseBuild,
    publish: [{ provider: "github", releaseType: "release" }],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: "always",
    createStartMenuShortcut: true,
  },
};
