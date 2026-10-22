import {useQuery} from '@tanstack/react-query';
import {apiRequest} from '../../lib/api';
import {isRecord} from '../../lib/record';
export function EvidenceList({projectId,storyId,ids}:{projectId:string;storyId:string;ids:string[]}) {
 return <section><h3>AI 分析依据</h3>{ids.length?ids.map(id=><EvidenceItem key={id} projectId={projectId} storyId={storyId} id={id}/>):<p>暂无原文证据，未提供的信息保持未知。</p>}</section>;
}
function EvidenceItem({projectId,storyId,id}:{projectId:string;storyId:string;id:string}) {
 const query=useQuery({queryKey:['projects',projectId,'stories',storyId,'evidence',id],queryFn:async({signal})=>{const v=await apiRequest({path:`/api/v1/projects/${projectId}/stories/${storyId}/evidence/${id}`,signal});if(!isRecord(v)||typeof v.quote!=='string')throw new Error('无效证据');return v;}});
 if(query.isPending)return <p>加载证据…</p>;
 if(query.isError)return <p>证据加载失败 <button onClick={()=>query.refetch()}>重试</button></p>;
 return <details><summary>片段 {Number(query.data.sequence)+1} · {query.data.source_type==='explicit'?'明确事实':'AI 推断'} · {Math.round(Number(query.data.confidence)*100)}%</summary><blockquote>{String(query.data.quote)}</blockquote><small>原文位置 {String(query.data.start_offset)}–{String(query.data.end_offset)}</small></details>;
}
