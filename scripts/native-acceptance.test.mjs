import test from 'node:test';
import assert from 'node:assert/strict';
import { createReport, validateReport } from './native-acceptance.mjs';
const input = {platform:'windows-x64',sourceRevision:'a'.repeat(40),packageBytes:Buffer.from('installer'),osVersion:'Windows 11',chromeVersion:'157.0',architecture:'x86_64'};
test('new native report cannot pass without actual observations', () => {
 const report=createReport(input);
 assert.ok(Object.values(report.cases).every(value=>value==='not-run'));
 assert.throws(()=>validateReport(report),/not passed/);
 assert.equal(report.review.approved,false);
 assert.equal(JSON.stringify(report).includes('installer_path'),false);
});
test('missing, skipped, inconclusive and failed cases never pass', () => {
 for(const value of [undefined,'skipped','inconclusive','failed']) {
  const report=createReport(input); Object.keys(report.cases).forEach(key=>report.cases[key]='passed');
  report.cases.emergency_release=value;
  assert.throws(()=>validateReport(report),/not passed/);
 }
});
test('complete manual observations pass locally without claiming PR approval',()=>{
 const report=createReport(input); Object.keys(report.cases).forEach(key=>report.cases[key]='passed');
 assert.doesNotThrow(()=>validateReport(report)); assert.equal(report.review.approved,false);
});
test('reports reject wrong architecture and invalid identity',()=>{
 assert.throws(()=>createReport({...input,architecture:'arm64'}),/architecture/);
 assert.throws(()=>createReport({...input,sourceRevision:'bad'}),/revision/);
});
