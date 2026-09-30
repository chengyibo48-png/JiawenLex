import { assertReleaseMutation } from './release-policy.mjs';
assertReleaseMutation();
import pg from 'pg';
import {readFile} from 'node:fs/promises';
if(!process.env.DATABASE_URL)process.loadEnvFile('.env.local');
const url=new URL(process.env.DATABASE_URL);
const project=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
if(!url.hostname.endsWith('.supabase.com')&&!url.hostname.endsWith('.supabase.co'))throw new Error('Unexpected database host');
if(!decodeURIComponent(url.username).includes(project)&&url.hostname!==`db.${project}.supabase.co`)throw new Error('Database project mismatch');
// Match this project's existing sslmode=require backup connection, without plaintext fallback.
url.searchParams.delete('sslmode');
const client=new pg.Client({connectionString:url.toString(),ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
try{
 await client.connect();
 const existing=await client.query("select to_regclass('public.study_guides') as present");
 if(!existing.rows[0].present){await client.query(await readFile('supabase/migrations/20260930020000_guides_and_word_memory.sql','utf8'));console.log('Learning migration applied');}
 else console.log('Learning migration already present');
 const bulk=await client.query("select to_regprocedure('public.publish_verified_word_cards(uuid[],boolean)') as present");
 if(!bulk.rows[0].present){await client.query(await readFile('supabase/migrations/20260930030000_batch_verified_word_cards.sql','utf8'));console.log('Bulk word publication migration applied');}
 await client.query(await readFile('supabase/migrations/20260930040000_learning_publication_fixes.sql','utf8'));console.log('Learning publication fixes applied');
}catch(error){console.error(error.code??'Migration failed');process.exitCode=1;}finally{await client.end();}
