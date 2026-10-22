import { createContext, useContext } from "react";

export type GraphActions = {
  openCharacter: (id: string) => void;
  deleteCharacter: (id: string) => void;
  openRelationship: (id: string) => void;
};

export const GraphActionsContext = createContext<GraphActions | null>(null);

export function useGraphActions() {
  return useContext(GraphActionsContext);
}
