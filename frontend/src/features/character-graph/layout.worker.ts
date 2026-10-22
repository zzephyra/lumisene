import {layoutGraph} from './layout';
import type {CharacterFlowNode} from './character-node';
self.onmessage=(event:MessageEvent<{nodes:CharacterFlowNode[];edges:{source:string;target:string}[]}>)=>{
 self.postMessage(layoutGraph(event.data.nodes,event.data.edges));
};
