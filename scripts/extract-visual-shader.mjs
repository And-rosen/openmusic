import fs from 'node:fs';

const src = fs.readFileSync(
  'C:/Users/sjb__/.cursor/projects/e-python-openmusic/agent-tools/eec08e87-b2ee-4c92-b99b-ff9888316cc5.txt',
  'utf8',
);
const marker = 'var vs = `';
const endMarker = '}\n`;\n\n// ----- 片元 Shader -----';
const start = src.indexOf(marker);
if (start < 0) throw new Error('start not found');
const end = src.indexOf('// ----- 片元 Shader -----', start);
if (end < 0) throw new Error('end not found');
const chunk = src.slice(start + marker.length, end);
const vs = chunk.replace(/\r/g, '').replace(/\n`;\s*$/, '');
const out = `/** Mineradio cover particle vertex shader (presets 0-5) */\nexport const PARTICLE_VERTEX_SHADER = \`${vs}\`;\n`;
fs.writeFileSync('e:/python/openmusic/client/src/components/galaxy/lib/visualVertexShader.ts', out);
console.log('written', vs.length, 'chars');
