/** A hover id may be one object, or a group such as `group:eigenspaces`. */
export function matchesFocus(id: string, focusId: string | null): boolean {
  if (!focusId) return false;
  if (id === focusId) return true;
  if (focusId.startsWith('multi:')) return focusId.slice(6).split(',').includes(id);
  switch (focusId) {
    case 'group:equilibria':
      return /^eq-\d+$/.test(id);
    case 'group:eigenspaces':
      return /:(Es|Eu|Ec)$/.test(id);
    case 'group:separatrices':
      return id.startsWith('separatrix-');
    case 'group:manifolds':
      return /-W[us]-/.test(id);
    case 'group:center':
      return /-Wc-/.test(id);
    case 'group:nullclines':
      return id.startsWith('nullcline-');
    case 'group:cycles':
      return id.startsWith('lc-');
    case 'group:trajectories':
      return id.startsWith('stream-');
    case 'group:hamiltonian':
      return id === 'hamiltonian';
    case 'group:lyapunov':
      return id === 'lyapunov';
    default:
      return false;
  }
}
