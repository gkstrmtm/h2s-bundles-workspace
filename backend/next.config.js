/** @type {import('next').NextConfig} */
const nextConfig = {
  // Add error handling
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 5,
  },
};

module.exports = nextConfig;
