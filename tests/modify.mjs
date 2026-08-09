import fs from 'node:fs';
let c = fs.readFileSync('index.html', 'utf8');
c = c.replace('<p id="modal-msg">', '<p id="modal-msg" style="white-space: pre-wrap; line-height: 1.6; text-align: left; margin: 1rem 0;">');
fs.writeFileSync('index.html', c);
