import { readFileSync } from 'node:fs';
export function releaseDecision({branch,message,version,packageVersion}) {
  const match=/^release: v(\d+\.\d+\.\d+)(?:\s|$)/.exec(message??'');
  return branch==='main' && !!match && match[1]===version && packageVersion===version;
}
export function assertReleaseMutation(args=process.argv) {
  const {version}=JSON.parse(readFileSync(new URL('../release.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
  if(!args.includes(`--release-version=${version}`)) throw Error(`Live data writes are locked. Only after the user requests a version update, pass --release-version=${version}. Local preparation and read-only audits remain available.`);
}
