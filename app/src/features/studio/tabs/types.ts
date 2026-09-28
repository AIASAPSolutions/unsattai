import type { DesignSpec, LayerPanel, Size } from '../../../api/types';
import { currentSpec, useFlow } from '../../../state/flow';

/** What every studio tool tab needs: the spec and the ways to change it. */
export interface StudioTools {
  spec: DesignSpec;
  /** One undo step. */
  edit: (spec: DesignSpec) => void;
  /** Live preview during a drag; wrap in begin/end so the drag is one undo step. */
  live: (spec: DesignSpec) => void;
  begin: () => void;
  end: () => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  /** Front/back side currently shown in the editor, used for new layers. */
  side: LayerPanel;
  sizes: Size[];
}

/** Latest spec, for callbacks that fire during a gesture (props may be one render behind). */
export function latestSpec(): DesignSpec | null {
  return currentSpec(useFlow.getState());
}
