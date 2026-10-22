import { Ellipsis } from "lucide-react";
import { memo, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { useGraphActions } from "./graph-actions";

export type CharacterNodeData = {
  characterId: string;
  name: string;
  title: string;
  roleType: string;
  age?: string;
  occupation?: string;
  avatarUrl?: string;
};
export type CharacterFlowNode = Node<CharacterNodeData, "character">;

const sides = [
  [Position.Top, "top"],
  [Position.Right, "right"],
  [Position.Bottom, "bottom"],
  [Position.Left, "left"],
] as const;

function identityLine(data: CharacterNodeData) {
  const parts = [data.age, data.occupation, data.title].map((item) => item?.trim()).filter(Boolean);
  return [...new Set(parts)].join(" · ");
}

function Avatar({ name, url }: { name: string; url?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="character-avatar">
      {url && !failed ? <img alt="" src={url} onError={() => setFailed(true)} /> : name.slice(0, 1)}
    </span>
  );
}

export const CharacterNode = memo(function CharacterNode({ data, selected }: NodeProps<CharacterFlowNode>) {
  const actions = useGraphActions();
  const identity = identityLine(data);
  const role = data.roleType?.trim() && data.roleType.trim() !== data.title?.trim() ? data.roleType.trim() : "";
  return (
    <div className={`character-node${selected ? " selected" : ""}`}>
      {sides.map(([position, id]) => (
        <span key={id}>
          <Handle className="character-handle" id={`in-${id}`} position={position} type="target" />
          <Handle className="character-handle" id={`out-${id}`} position={position} type="source" />
        </span>
      ))}
      <div className="character-card-main">
        <Avatar key={data.avatarUrl ?? "empty"} name={data.name} url={data.avatarUrl} />
        <div className="character-summary">
          <div className="character-title-row">
            <strong title={data.name}>{data.name}</strong>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`${data.name}的操作`}
                  className="character-menu nodrag nopan"
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <Ellipsis aria-hidden size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-28 p-1">
                <DropdownMenuItem className="h-8 px-2 text-xs" onSelect={() => actions?.openCharacter(data.characterId)}>编辑</DropdownMenuItem>
                <DropdownMenuItem className="h-8 px-2 text-xs" onSelect={() => actions?.deleteCharacter(data.characterId)}>删除</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {identity && <span title={identity}>{identity}</span>}
          {role && <small>{role}</small>}
        </div>
      </div>
    </div>
  );
});
