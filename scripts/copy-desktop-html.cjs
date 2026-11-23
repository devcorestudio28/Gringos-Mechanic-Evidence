const fs = require('node:fs');
const path = require('node:path');

const destination = path.join(__dirname, '..', 'dist', 'desktop', 'index.html');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'src', 'desktop', 'index.html'), destination);
