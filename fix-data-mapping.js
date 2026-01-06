const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'bundles.js');
let content = fs.readFileSync(targetFile, 'utf8');

// FIX: fetchOrder returns raw JSON, but consumption expects flattened object.
// PATCH: Change "return await res.json();" to "const data = await res.json(); return data.order || data;"

const oldFetch = "return await res.json();";
const newFetch = "const data = await res.json(); return data.order || data;";

if (content.includes(oldFetch)) {
    content = content.replace(oldFetch, newFetch);
    console.log("Fixed fetchOrder unwrap logic.");
} else {
    console.warn("Could not find fetchOrder return statement to fix.");
}

// FIX: Backend uses 'amount_total', frontend was looking for 'order_total' mostly.
// PATCH: Update the ordered fields to look for amount_total too.
// "order.order_total||0" -> "order.amount_total||order.order_total||0"

const oldTotal = "money(order.order_total||0)";
const newTotal = "money(order.amount_total||order.order_total||0)";

if (content.includes(oldTotal)) {
    content = content.replace(oldTotal, newTotal);
    console.log("Fixed amount_total field access.");
} else {
     // It might be minified or differently spaced in my previous patch?
     // Let's look for the substring carefully
     console.warn("Could not match money(...) exact string. Attempting regex.");
     content = content.replace(/money\(order\.order_total\|\|0\)/g, "money(order.amount_total||order.order_total||0)");
}

fs.writeFileSync(targetFile, content);
console.log("Applied hotfix to bundles.js");
