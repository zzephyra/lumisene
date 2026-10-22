import type { components } from '../../api/schema';
import { apiRequest } from '../../lib/api';
import { isRecord } from '../../lib/record';
export type Character = components['schemas']['CharacterView'];
export type Relationship = components['schemas']['RelationshipView'];
export type Graph = components['schemas']['GraphView'];
export type Profile = components['schemas']['Profile'];
export type Selection = {kind:'none'} | {kind:'character'|'relationship'; id:string};
const base = (p:string, story:string) => `/api/v1/projects/${p}/stories/${story}`;
function object(value:unknown): asserts value is Record<string,unknown> { if(!isRecord(value)) throw new Error('无效的服务端响应'); }
function entity(value:unknown) { object(value); if(typeof value.id!=='string' || typeof value.version!=='number') throw new Error('无效的实体响应'); }
export async function graph(p:string,story:string,signal?:AbortSignal):Promise<Graph> {
 const v=await apiRequest({path:base(p,story)+'/character-graph',signal}); object(v);
 if(!Array.isArray(v.characters)||!Array.isArray(v.relationships)||!isRecord(v.layout)) throw new Error('无效的图谱响应');
 v.characters.forEach(entity); v.relationships.forEach(entity);
 return v as Graph;
}
export async function detail(p:string, story:string, selection:Exclude<Selection,{kind:'none'}>,signal?:AbortSignal):Promise<Character|Relationship> {
 const v=await apiRequest({path:`${base(p,story)}/${selection.kind==='character'?'characters':'relationships'}/${selection.id}`,signal});entity(v);return v as Character|Relationship;
}
export async function save(p:string, story:string, kind:'character'|'relationship', body:unknown,id?:string) {
 const v=await apiRequest({path:`${base(p,story)}/${kind==='character'?'characters':'relationships'}${id?'/'+id:''}`,method:id?'PATCH':'POST',csrf:true,body});entity(v);return v as Character|Relationship;
}
export async function remove(p:string, story:string, kind:'character'|'relationship',id:string,version:number) {
 await apiRequest({path:`${base(p,story)}/${kind==='character'?'characters':'relationships'}/${id}?expected_version=${version}`,method:'DELETE',csrf:true});
}
export async function saveLayout(p:string,story:string,body:components['schemas']['LayoutInput']):Promise<components['schemas']['LayoutView']> {
 const v=await apiRequest({path:base(p,story)+'/character-graph/layout',method:'PUT',csrf:true,body});object(v);if(typeof v.version!=='number')throw new Error('无效的布局响应');return v as components['schemas']['LayoutView'];
}
