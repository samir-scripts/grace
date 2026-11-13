import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateCandidateRun(run, jobs, sourceRevision) {
  if (!/^[a-f0-9]{40}$/.test(sourceRevision ?? '') || run.head_sha !== sourceRevision || run.repository?.full_name !== 'samir-scripts/grace' || run.path !== '.github/workflows/release.yml' || run.status !== 'completed') throw new Error('Candidate must be a completed same-source release workflow');
  for (const name of ['Linux x64','macOS (universal)','Windows x64']) {
    const matches=jobs.filter(job=>job.name===name);
    if(matches.length!==1 || matches[0].conclusion!=='success') throw new Error('Candidate build not successful: '+name);
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {
  const [runId,sourceRevision]=process.argv.slice(2);
  if(!/^[1-9]\d*$/.test(runId ?? '')) throw new Error('Candidate run ID required');
  const endpoint='repos/samir-scripts/grace/actions/runs/'+runId;
  const run=JSON.parse(execFileSync('gh',['api',endpoint],{encoding:'utf8'}));
  const pages=JSON.parse(execFileSync('gh',['api','--paginate','--slurp',endpoint+'/jobs'],{encoding:'utf8'}));
  validateCandidateRun(run,pages.flatMap(page=>page.jobs),sourceRevision);
  console.log('Verified exact-source candidate artifacts; no rebuild required.');
 }catch(error){console.error(error.status?'Could not verify candidate run against GitHub.':error.message);process.exitCode=1;}
}
