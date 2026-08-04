/** @type {import('next').NextConfig} */
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin')

module.exports = {
  output: 'export',
  distDir: process.env.NODE_ENV === 'production' ? '../app' : '.next',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  transpilePackages: [
    '@openai/apps-sdk-ui',
    'antd',
    '@ant-design',
    'rc-util',
    'rc-pagination',
    'rc-picker',
    'rc-notification',
    'rc-tooltip',
    'rc-tree',
    'rc-table',
    '@rc-component', // 关键：解决 @rc-component/util 的报错
  ],
  webpack: (config, { dev }) => {
    if (!dev) {
      config.optimization.minimizer = (config.optimization.minimizer || []).filter(
        (plugin) => !(
          plugin?.constructor?.name === 'CssMinimizerPlugin' ||
          (typeof plugin === 'function' && plugin.toString().includes('CssMinimizerPlugin'))
        )
      )
      config.optimization.minimizer.push(
        new CssMinimizerPlugin({
          minify: CssMinimizerPlugin.lightningCssMinify,
        })
      )
    }
    return config
  },
}
