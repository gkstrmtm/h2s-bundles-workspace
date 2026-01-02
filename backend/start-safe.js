// Error-safe Next.js startup wrapper
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error);
  console.error('Stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
});

process.on('warning', (warning) => {
  console.warn('⚠️ WARNING:', warning.name, warning.message);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

console.log('🚀 Starting Next.js with error handling...');
console.log('📁 Working directory:', process.cwd());
console.log('🔧 Node version:', process.version);
console.log('📦 Environment:', process.env.NODE_ENV || 'development');

// Import and run Next.js CLI
// This keeps the process alive
require('next/dist/bin/next');
