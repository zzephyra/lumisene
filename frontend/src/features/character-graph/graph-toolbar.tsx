import { LayoutDashboard, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";

type Props = {
  search: string;
  onSearch: (value: string) => void;
  role: string;
  onRole: (value: string) => void;
  relation: string;
  onRelation: (value: string) => void;
  roles: string[];
  relationTypes: string[];
  onFocus: () => void;
  onLayout: () => void;
  onFit: () => void;
  onAdd: () => void;
};

/** Only presentation lives here; graph selection, filters and viewport remain owned by the canvas. */
export function GraphToolbar(props: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const active = Number(!!props.role) + Number(!!props.relation);
  return (
    <div className="graph-tools">
      <DropdownMenu open={searchOpen} onOpenChange={setSearchOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="story-icon"
            aria-label="搜索人物"
          >
            <Search size={17} />
            <span className="graph-tip" aria-hidden>
              搜索人物
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64"
          onCloseAutoFocus={(event) => {
            if (searchOpen) event.preventDefault();
          }}
        >
          <input
            autoFocus
            className="h-9 w-full rounded-md border border-line bg-canvas px-3 text-sm"
            aria-label="人物姓名"
            placeholder="搜索人物，回车定位"
            value={props.search}
            onChange={(event) => props.onSearch(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                props.onFocus();
                setSearchOpen(false);
              }
              if (event.key === "Escape") setSearchOpen(false);
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="story-icon graph-filter-trigger"
            aria-label={`筛选${active ? `（${active}）` : ""}`}
          >
            <SlidersHorizontal size={17} />
            {active > 0 && <span className="graph-filter-count">{active}</span>}
            <span className="graph-tip" aria-hidden>
              筛选
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
          <DropdownMenuLabel>人物类型</DropdownMenuLabel>
          {["", ...props.roles].map((value) => (
            <DropdownMenuItem
              key={value}
              onSelect={(event) => {
                event.preventDefault();
                props.onRole(value);
              }}
            >
              {props.role === value ? "✓ " : ""}
              {value || "全部人物"}
            </DropdownMenuItem>
          ))}
          <DropdownMenuLabel>关系类型</DropdownMenuLabel>
          {["", ...props.relationTypes].map((value) => (
            <DropdownMenuItem
              key={value}
              onSelect={(event) => {
                event.preventDefault();
                props.onRelation(value);
              }}
            >
              {props.relation === value ? "✓ " : ""}
              {value || "全部关系"}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onSelect={() => {
              props.onRole("");
              props.onRelation("");
            }}
          >
            重置筛选
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="story-icon"
            aria-label="画布布局"
          >
            <LayoutDashboard size={17} />
            <span className="graph-tip" aria-hidden>
              画布布局
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={props.onFocus}>定位人物</DropdownMenuItem>
          <DropdownMenuItem onSelect={props.onLayout}>
            自动布局
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={props.onFit}>适配视图</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        className="story-icon graph-add"
        aria-label="添加人物"
        onClick={props.onAdd}
      >
        <Plus size={17} />
        <span className="graph-tip" aria-hidden>
          添加人物
        </span>
      </Button>
    </div>
  );
}
