import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { requiredCases } from './release-policy.mjs';

export function createReport({ platform, sourceRevision, packageBytes, osVersion, chromeVersion, architecture }) {
  if (!['windows-x64','ubuntu-x64'].includes(platform)) throw new Error('Unsupported platform');
  if (architecture !== 'x86_64') throw new Error('Native x64 architecture required');
  if (!/^[a-f0-9]{40}$/.test(sourceRevision ?? '')) throw new Error('Exact source revision required');
  if (!osVersion?.trim() || !chromeVersion?.trim() || !packageBytes?.length) throw new Error('Package, OS and Chrome versions required');
  return { platform, source_revision: sourceRevision, package_sha256: createHash('sha256').update(packageBytes).digest('hex'), os_version: osVersion, chrome_version: chromeVersion, architecture,
    review: {pr_url:'',reviewer:'',approved:false}, cases:Object.fromEntries(requiredCases.map(name=>[name,'not-run'])) };
}
export function validateReport(report) {
  createReport({platform:report.platform,sourceRevision:report.source_revision,packageBytes:Buffer.from('validation'),osVersion:report.os_version,chromeVersion:report.chrome_version,architecture:report.architecture});
  if (!/^[a-f0-9]{64}$/.test(report.package_sha256 ?? '')) throw new Error('Package SHA-256 required');
  for (const name of requiredCases) if (report.cases?.[name] !== 'passed') throw new Error('Native case not passed: '+name);
}
function main(args) {
  if (args.length===2 && args[0]==='--validate') {
    validateReport(JSON.parse(fs.readFileSync(args[1],'utf8')));
    console.log('All manual cases marked passed. Independent PR review is still required before stable acceptance.'); return;
  }
  const options={};
  for(let i=0;i<args.length;i+=2) {
    if(!['--platform','--package','--source-revision','--chrome-version','--output'].includes(args[i]) || !args[i+1] || options[args[i]]) throw new Error('Invalid arguments');
    options[args[i]]=args[i+1];
  }
  const expected=process.platform==='win32'?'windows-x64':process.platform==='linux'?'ubuntu-x64':null;
  if(options['--platform']!==expected || process.arch!=='x64') throw new Error('Run only on the actual target x64 OS');
  let osVersion=os.type()+' '+os.release();
  if(expected==='ubuntu-x64') {
    const release=fs.readFileSync('/etc/os-release','utf8');
    if(!/^ID=ubuntu$/m.test(release)) throw new Error('Ubuntu required; other distributions need separate acceptance');
    const version=release.match(/^VERSION_ID="?([^"\n]+)"?$/m)?.[1];
    if(!version) throw new Error('Ubuntu version unavailable'); osVersion='Ubuntu '+version;
  }
  const report=createReport({platform:expected,sourceRevision:options['--source-revision'],packageBytes:fs.readFileSync(options['--package']),osVersion,chromeVersion:options['--chrome-version'],architecture:'x86_64'});
  fs.writeFileSync(options['--output'],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log('Report created with every native case not-run. Complete the disposable-environment checklist; no native acceptance claimed.');
  process.exitCode=2;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 try{main(process.argv.slice(2));}catch(error){console.error(error.code?'Acceptance report unavailable; check input paths and permissions.':error.message);process.exitCode=1;}
}
