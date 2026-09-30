import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {releaseDecision} from './release-policy.mjs';
let allowed=false;
try {
 const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
 const version=read('release.json').version,packageVersion=read('package.json').version;
 const message=process.env.VERCEL_GIT_COMMIT_MESSAGE??execFileSync('git',['log','-1','--format=%B'],{encoding:'utf8',windowsHide:true}).trim();
 const branch=process.env.VERCEL_GIT_COMMIT_REF??execFileSync('git',['branch','--show-current'],{encoding:'utf8',windowsHide:true}).trim();
 allowed=releaseDecision({branch,message,version,packageVersion});
} catch { /* Missing metadata keeps deployment closed. */ }
console.log(allowed?'Approved version release; continue build':'Development change; skip deployment');
// Vercel ignoreCommand uses 0 to cancel and 1 to continue.
process.exit(allowed?1:0);
