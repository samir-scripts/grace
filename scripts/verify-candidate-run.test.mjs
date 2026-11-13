import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCandidateRun } from './verify-candidate-run.mjs';
const source='a'.repeat(40);
const run={head_sha:source,path:'.github/workflows/release.yml',status:'completed',repository:{full_name:'samir-scripts/grace'}};
const jobs=['Linux x64','macOS (universal)','Windows x64'].map(name=>({name,conclusion:'success'}));
test('stable promotion reuses completed exact-source builds despite native publication hold',()=>{
 assert.doesNotThrow(()=>validateCandidateRun({...run,conclusion:'failure'},jobs,source));
});
test('rejects stale, foreign, incomplete and failed candidate packages',()=>{
 for(const changed of [{...run,head_sha:'b'.repeat(40)},{...run,status:'in_progress'},{...run,path:'.github/workflows/other.yml'},{...run,repository:{full_name:'other/repo'}}])assert.throws(()=>validateCandidateRun(changed,jobs,source));
 assert.throws(()=>validateCandidateRun(run,jobs.slice(1),source));
 assert.throws(()=>validateCandidateRun(run,[{name:'Linux x64',conclusion:'failure'},...jobs.slice(1)],source));
});
