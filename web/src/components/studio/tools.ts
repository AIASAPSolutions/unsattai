import type { DesignSpec, LayerPanel, Size } from '@/lib/api/types';
import { flowStore } from '@/lib/flow';

export interface StudioTools {
  spec: DesignSpec;
  selectedId: string | null;
  select: (id: string | null) => void;
  side: LayerPanel;
  sizes: Size[];
}

/** The spec as it is right now (a live drag may have changed it since the last render). */
export function latestSpec(): DesignSpec | null {
  return flowStore.get().history?.present ?? null;
}
