import {describe,it,expect} from 'vitest';
import {layoutGraph} from './layout';
import type {CharacterFlowNode} from './character-node';
describe('character network layout',()=>{
 for(const count of [10,30,100,300])it(`lays out ${count} cyclic characters without mutation`,()=>{
  const nodes:CharacterFlowNode[]=Array.from({length:count},(_,i)=>({id:String(i),type:'character',position:{x:0,y:0},data:{characterId:String(i),name:`人物${i}`,title:'',roleType:''}}));
  const edges=nodes.map((n,i)=>({source:n.id,target:nodes[(i+1)%count].id}));
  const started=performance.now();const result=layoutGraph(nodes,edges);
  expect(result).toHaveLength(count);
  expect(result.every(n=>Number.isFinite(n.position.x)&&Number.isFinite(n.position.y))).toBe(true);
  expect(nodes.every(n=>n.position.x===0)).toBe(true);
  expect(new Set(result.map(n=>`${Math.round(n.position.x)},${Math.round(n.position.y)}`)).size).toBe(count);
  console.info(`layout ${count}: ${Math.round(performance.now()-started)}ms`);
 });
});
