import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {brandAssets,brandVersion} from '../lib/brand.ts';
test('Final brand artwork has a content version and every icon exists',async()=>{
 const master=await fs.readFile(new URL('../public/jiawenlex-icon.png',import.meta.url));
 assert.equal(brandVersion,createHash('sha256').update(master).digest('hex').slice(0,12));
 for(const resource of Object.values(brandAssets)){
  assert.equal(resource.split('?')[1],'v='+brandVersion);
  assert.ok((await fs.readFile(new URL('../public'+resource.split('?')[0],import.meta.url))).length>0);
 }
});
test('All four workspace and authentication logos use the shared final artwork',async()=>{
 const source=await fs.readFile(new URL('../components/workspace.tsx',import.meta.url),'utf8');
 assert.equal(source.match(/src={brandAssets.logo}/g)?.length,4);
 assert.doesNotMatch(source,/src="\/jiawenlex-icon.png"/);
 const metadata=await fs.readFile(new URL('../app/layout.tsx',import.meta.url),'utf8');
 for(const key of ['favicon','icon','apple'])assert.ok(metadata.includes('brandAssets.'+key));
 assert.doesNotMatch(metadata,/"\/favicon.svg"/);
});
test('Legacy SVG fallback embeds the same final 192px icon',async()=>{
 const svg=await fs.readFile(new URL('../public/favicon.svg',import.meta.url),'utf8');
 const image=await fs.readFile(new URL('../public/favicon-192.png',import.meta.url));
 const embedded=svg.match(/data:image\/png;base64,([^"\s]+)/);
 assert.ok(embedded);assert.deepEqual(Buffer.from(embedded[1],'base64'),image);
});
