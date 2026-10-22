import {forceSimulation,forceLink,forceManyBody,forceCollide,forceCenter,type SimulationNodeDatum} from 'd3-force';
import type {CharacterFlowNode} from './character-node';
type Point=SimulationNodeDatum & {id:string};
export function layoutGraph(nodes:CharacterFlowNode[],edges:{source:string;target:string}[]) {
 const points:Point[]=nodes.map(n=>({id:n.id,x:n.position.x,y:n.position.y}));
 const links=edges.map(e=>({...e}));
 const simulation=forceSimulation(points).force('link',forceLink<Point, typeof links[number]>(links).id(n=>n.id).distance(360)).force('charge',forceManyBody().strength(-640)).force('collision',forceCollide(168)).force('center',forceCenter(0,0)).stop();
 simulation.tick(250);
 return nodes.map((n,i)=>({...n,position:{x:points[i].x??0,y:points[i].y??0}}));
}
