import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Katex } from '../../ui/Katex';
import { downloadPng, downloadSvg } from '../render/exportView';
import { activeFrame, usePdeStore } from '../store';
import { Examples } from './Examples';
import { Notes } from './Notes';
import { ObjectTree } from './ObjectTree';
import { ProblemForm } from './ProblemForm';
import { CharPlane } from '../render/CharPlane';
import { ClassPlane } from '../render/ClassPlane';
import { Heatmap } from '../render/Heatmap';
import { Modes } from '../render/Modes';
import { Profile } from '../render/Profile';

const Surface3D = lazy(() => import('../render/Surface3D').then((mod) => ({ default: mod.Surface3D })));

function useNarrowStudy() {
  const query = '(max-width: 860px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return narrow;
}

function clampPanel(total: number, height: number) {
  const minPanel = 124;
  const minPicture = 160;
  const maxPanel = Math.max(minPanel, total - minPicture);
  return Math.min(maxPanel, Math.max(minPanel, height));
}

function Picture() {
  const solution = usePdeStore((state) => state.solution);
  const error = usePdeStore((state) => state.error);
  const frameId = usePdeStore((state) => state.frame);
  const setFrame = usePdeStore((state) => state.setFrame);
  if (!solution) return <p className="status">{error ?? 'The picture appears when the problem solves.'}</p>;
  const original = solution.frames.find((frame) => frame.id === 'original');
  const simplified = solution.frames.find((frame) => frame.id === 'simplified');
  const both = Boolean(original && simplified);
  const mapLatex = simplified?.mapLatex || original?.mapLatex;
  const active = activeFrame(solution, frameId);

  return (
    <div className="portrait-page">
      {both && original && simplified && (
        <div>
          <div className="button-row">
            <button type="button" className={frameId === 'original' ? 'real-button on' : 'real-button'} onClick={() => setFrame('original')}>
              {original.name}
            </button>
            <button type="button" className={frameId === 'simplified' ? 'real-button on' : 'real-button'} onClick={() => setFrame('simplified')}>
              {simplified.name}
            </button>
          </div>
          {mapLatex ? (
            <p className="object-text">
              <Katex tex={mapLatex} />
            </p>
          ) : null}
        </div>
      )}
      <div className="portrait-primary">
        {solution.family === 'heat' ? <Heatmap /> : solution.family === 'classify' ? <ClassPlane /> : <CharPlane />}
      </div>
      <div className="portrait-extras">
        {solution.family === 'heat' && active && solution.spatial === 'x' ? <Profile /> : null}
        {solution.family === 'heat' && solution.modes.length > 0 ? <Modes /> : null}
        {solution.family === 'classify' ? null : (
          <Suspense fallback={<p className="status">Loading the surface…</p>}>
            <Surface3D />
          </Suspense>
        )}
      </div>
    </div>
  );
}

function Visualization() {
  return (
    <div className="side-stack">
      <ObjectTree />
      <p className="note-exports">
        <button type="button" className="real-button" onClick={downloadSvg}>
          Download SVG
        </button>
        <button type="button" className="real-button" onClick={downloadPng}>
          Download PNG
        </button>
      </p>
    </div>
  );
}

function About() {
  return (
    <div className="system-page about-page">
      <h1>About</h1>
      <p>This page is for working with the heat equation and with characteristics, after you have tried the problem by hand.</p>
      <p>
        For any issues / questions / ideas you can email me at: <a href="mailto:gregorio.jaca@gmail.com">gregorio.jaca@gmail.com</a>
      </p>
      <p>
        To contribute, please check out <a href="https://github.com/GregoJaca/dynamical-systems">https://github.com/GregoJaca/dynamical-systems</a>
      </p>
      <p>
        <a href="../">Back to dynamical systems</a>
      </p>
    </div>
  );
}

export function PdeApp() {
  const theme = usePdeStore((state) => state.theme);
  const view = usePdeStore((state) => state.view);
  const setView = usePdeStore((state) => state.setView);
  const setTheme = usePdeStore((state) => state.setTheme);
  const copyShareLink = usePdeStore((state) => state.copyShareLink);
  const [notice, setNotice] = useState('');
  const [studyTab, setStudyTab] = useState<'system' | 'picture' | 'notes'>('system');
  const narrow = useNarrowStudy();
  const sideScrollRef = useRef<HTMLDivElement>(null);
  const studyRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const splitDrag = useRef<{ pointer: number; startY: number; startHeight: number } | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const panelHeightRef = useRef<number | null>(null);
  panelHeightRef.current = panelHeight;
  const openStudyTab = (tab: 'system' | 'picture' | 'notes') => {
    setStudyTab(tab);
    if (narrow) sideScrollRef.current?.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (!narrow) return;
    const grid = studyRef.current;
    if (!grid) return;
    setPanelHeight((current) => clampPanel(grid.clientHeight, current ?? Math.round(grid.clientHeight * 0.42)));
  }, [narrow]);

  useEffect(() => {
    const grid = studyRef.current;
    if (!grid || !narrow) return;
    const observer = new ResizeObserver(() => {
      setPanelHeight((current) => (current == null ? current : clampPanel(grid.clientHeight, current)));
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [narrow]);

  const onSplitPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || !narrow || panelHeight == null) return;
    splitDrag.current = { pointer: event.pointerId, startY: event.clientY, startHeight: panelHeight };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* The drag still tracks while the pointer stays on the handle. */
    }
  };

  const onSplitPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = splitDrag.current;
    const grid = studyRef.current;
    if (!drag || drag.pointer !== event.pointerId || !grid) return;
    setPanelHeight(clampPanel(grid.clientHeight, drag.startHeight - (event.clientY - drag.startY)));
  };

  const onSplitPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (splitDrag.current?.pointer === event.pointerId) splitDrag.current = null;
  };

  useEffect(() => {
    const handle = splitRef.current;
    if (!handle) return;
    let active = false;
    let startY = 0;
    let startH = 0;

    const onTouchMove = (event: TouchEvent) => {
      if (!active) return;
      event.preventDefault();
      const grid = studyRef.current;
      const touch = event.touches[0];
      if (!grid || !touch) return;
      setPanelHeight(clampPanel(grid.clientHeight, startH - (touch.clientY - startY)));
    };

    const onTouchEnd = () => {
      active = false;
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (!window.matchMedia('(max-width: 860px)').matches || event.touches.length !== 1) return;
      event.preventDefault();
      const grid = studyRef.current;
      active = true;
      startY = event.touches[0].clientY;
      startH = panelHeightRef.current ?? (grid ? Math.round(grid.clientHeight * 0.42) : 280);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', onTouchEnd);
      window.addEventListener('touchcancel', onTouchEnd);
    };

    handle.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => {
      handle.removeEventListener('touchstart', onTouchStart);
      onTouchEnd();
    };
  }, [view]);

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  const share = async () => {
    const url = copyShareLink();
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Link copied');
    } catch {
      setNotice('Link is in the address bar');
    }
    window.setTimeout(() => setNotice(''), 1600);
  };

  return (
    <div className="app">
      <header className="topbar">
        <nav>
          <button type="button" className={view === 'home' ? 'current' : ''} onClick={() => setView('home')}>
            Home
          </button>
          <button type="button" className={view === 'examples' ? 'current' : ''} onClick={() => setView('examples')}>
            Examples
          </button>
          <button type="button" className={view === 'about' ? 'current' : ''} onClick={() => setView('about')}>
            About
          </button>
        </nav>
        <div className="top-actions">
          {notice && <span>{notice}</span>}
          <button type="button" className="text-button" onClick={() => void share()}>
            Share
          </button>
          <button type="button" className="text-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </header>
      <main className={view === 'study' ? 'study-main' : ''}>
        {view === 'home' && (
          <div className="system-page">
            <h1>Heat and characteristics</h1>
            <p className="lede">Write the equation with its domain and data, then study how the solution moves.</p>
            <ProblemForm />
          </div>
        )}
        {view === 'study' && (
          <div className="study-grid" ref={studyRef}>
            <div className="study-picture">
              <Picture />
            </div>
            <div
              ref={splitRef}
              className="study-split"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize panels"
              aria-valuemin={124}
              aria-valuenow={panelHeight ?? undefined}
              tabIndex={0}
              onPointerDown={onSplitPointerDown}
              onPointerMove={onSplitPointerMove}
              onPointerUp={onSplitPointerUp}
              onPointerCancel={onSplitPointerUp}
              onKeyDown={(event) => {
                if (!narrow || panelHeight == null || !studyRef.current) return;
                const step = event.key === 'ArrowUp' ? 28 : event.key === 'ArrowDown' ? -28 : 0;
                if (!step) return;
                event.preventDefault();
                setPanelHeight(clampPanel(studyRef.current.clientHeight, panelHeight + step));
              }}
            />
            <aside className="study-side" style={narrow && panelHeight != null ? { height: panelHeight } : undefined}>
              <div className="tabs">
                <button type="button" className={studyTab === 'system' ? 'current' : ''} onClick={() => openStudyTab('system')}>
                  System
                </button>
                <button type="button" className={studyTab === 'picture' ? 'current' : ''} onClick={() => openStudyTab('picture')}>
                  Visualization
                </button>
                <button type="button" className={studyTab === 'notes' ? 'current' : ''} onClick={() => openStudyTab('notes')}>
                  Notes
                </button>
              </div>
              <div className="side-scroll" ref={sideScrollRef}>
                <div className="side-body">
                  {studyTab === 'system' && <ProblemForm />}
                  {studyTab === 'picture' && <Visualization />}
                  {studyTab === 'notes' && <Notes />}
                </div>
              </div>
            </aside>
          </div>
        )}
        {view === 'examples' && <Examples />}
        {view === 'about' && <About />}
      </main>
    </div>
  );
}
