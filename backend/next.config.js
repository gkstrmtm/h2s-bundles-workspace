/** @type {import('next').NextConfig} */
const nextConfig = {
  // Add error handling
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },
  webpack: (config) => {
    // In dev, prevent the file watcher from tracking local artifacts that can grow large
    // (logs, generated single-file dashboards, scratch exports). This reduces churn and
    // lowers the likelihood of heap pressure / watchpack blow-ups on Windows.
    config.watchOptions ||= {};

    const ignored = config.watchOptions.ignored;
    const ignoredList = Array.isArray(ignored) ? ignored.slice() : ignored ? [ignored] : [];

    ignoredList.push(
      /[\\/]\.logs[\\/]/,
      /[\\/]public[\\/]dash\.html$/,
      /[\\/]public[\\/]dash\.PORTAL_BUILD_[^\\/]+\.(js|css)$/,
      /[\\/]\_tmp\_[^\\/]+/,
      /[\\/]\_live\_[^\\/]+/,
      /[\\/]archive[\\/]/
    );

    config.watchOptions.ignored = ignoredList;
    return config;
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
