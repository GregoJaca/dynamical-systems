import type { InspectorTab } from '../core/types';
import { useSystemStore } from '../store/useSystemStore';
import { CoordinatesPanel } from './CoordinatesPanel';
import { EquilibriaPanel } from './EquilibriaPanel';
import { ObjectTree } from './ObjectTree';
import { TheoremsPanel } from './TheoremsPanel';

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'objects', label: 'Objects' },
  { id: 'equilibria', label: 'Equilibria' },
  { id: 'coordinates', label: 'Coordinates' },
  { id: 'theorems', label: 'Theorems' },
];

export function InspectorDrawer({ onClose }: { onClose: () => void }) {
  const tab = useSystemStore((state) => state.inspectorTab);
  const setInspectorTab = useSystemStore((state) => state.setInspectorTab);
  const casWarnings = useSystemStore((state) => state.casWarnings);

  return (
    <aside className="glass flex h-full w-[380px] flex-col rounded-3xl">
      <header className="flex items-center justify-between px-4 pt-4">
        <p className="text-[11px] uppercase tracking-[0.18em] opacity-60">Inspector</p>
        <button type="button" className="rounded-full px-2 py-1 text-xs opacity-70" onClick={onClose}>
          Hide
        </button>
      </header>
      <div className="flex gap-1 px-3 py-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded-full px-2.5 py-1 text-xs ${tab === item.id ? 'bg-[#f0b429]/20 text-[#f0b429]' : 'opacity-75'}`}
            onClick={() => setInspectorTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="scroll-thin flex-1 overflow-auto px-4 pb-4">
        {tab === 'objects' && <ObjectTree />}
        {tab === 'equilibria' && <EquilibriaPanel />}
        {tab === 'coordinates' && <CoordinatesPanel />}
        {tab === 'theorems' && <TheoremsPanel />}
        {casWarnings.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs opacity-70">
            {casWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
