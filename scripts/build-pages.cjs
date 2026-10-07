// Produce a static Pages artifact; development files never enter the site.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const entryFiles = ['index.html', 'style.css', 'game.js', '.nojekyll'];
const images = fs.readdirSync(path.join(root, 'images'));
const files = [...entryFiles, ...images.map(name => `images/${name}`)];

// GitHub Pages is case-sensitive, unlike typical local Windows paths.
for (const entry of ['index.html', 'style.css']) {
  const source = fs.readFileSync(path.join(root, entry), 'utf8');
  const references = [...source.matchAll(/(?:src|href)=["']([^"']+)["']|url\(["']?([^"')]+)["']?\)/g)];
  for (const match of references) {
    const reference = match[1] || match[2];
    if (/^https?:\/\//.test(reference)) continue;
    if (!files.includes(reference)) throw new Error(`${entry}: missing or incorrectly capitalized asset ${reference}`);
    const resolved = new URL(reference, 'https://example.github.io/ginny-kong/');
    if (!resolved.pathname.startsWith('/ginny-kong/')) throw new Error(`Asset escapes the GitHub Pages project path: ${reference}`);
  }
}
fs.mkdirSync(path.join(output, 'images'), { recursive: true });
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, file));
console.log(`Prepared ${files.length} files for GitHub Pages in dist/.`);
