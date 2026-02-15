const fs = require('fs');

const html = fs.readFileSync('frontend/dash.html', 'utf8');

console.log('length', html.length);
console.log('headPreview', JSON.stringify(html.slice(0, 1200)));

const styleMatches = html.match(/<style\b/gi) || [];
const scriptMatches = html.match(/<script\b/gi) || [];
console.log('styleTagCount', styleMatches.length);
console.log('scriptTagCount', scriptMatches.length);

function firstIndex(label, needle) {
  const idx = html.indexOf(needle);
  console.log(label, idx);
}

firstIndex('idx <style>', '<style>');
firstIndex('idx </style>', '</style>');
firstIndex('idx "CRITICAL CSS"', 'CRITICAL CSS');
firstIndex('idx "// Configuration - H2S Backend API"', '// Configuration - H2S Backend API');
firstIndex('idx <script> (first)', '<script>');
firstIndex('idx </script> (first)', '</script>');

// Also show a short snippet around the CRITICAL marker if present.
const marker = 'CRITICAL CSS';
const m = html.indexOf(marker);
if (m >= 0) {
  console.log('marker snippet:', JSON.stringify(html.slice(Math.max(0, m - 30), m + marker.length + 30)));
} else {
  // Try a looser search for CRITICAL and CSS separately
  const m2 = html.indexOf('CRITICAL');
  const m3 = html.indexOf('CSS');
  console.log('idx CRITICAL', m2);
  console.log('idx CSS', m3);
  if (m2 >= 0) console.log('CRITICAL snippet:', JSON.stringify(html.slice(Math.max(0, m2 - 30), m2 + 80)));
}
