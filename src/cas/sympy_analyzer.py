"""Exact SymPy analysis for the Pyodide worker.

Returns a CasEnrichment dict: equilibrium patches, Taylor jets of Ws/Wu/Wc,
coordinate changes, and global first integrals. Non-autonomous systems are skipped.
For x' = x, y' = -y + x^2 the unstable manifold is y = x^2/3 and the stable manifold is x = 0.
"""

from __future__ import annotations

import json
import re
from itertools import product
from typing import Any

import sympy as sp

SOLVE_DEGREE_LIMIT = 8
SERIES_LIMIT = 5
REAL_TOL = 1e-8


def analyze_json(payload_json: str) -> str:
    revision = 0
    try:
        payload = json.loads(payload_json)
        if isinstance(payload, dict):
            revision = int(payload.get("revision", 0) or 0)
        result = analyze(payload if isinstance(payload, dict) else {})
    except Exception as exc:  # noqa: BLE001 - the worker must return JSON, not raise
        result = {
            "revision": revision,
            "equilibriaPatches": [],
            "manifoldSeries": [],
            "warnings": [f"{type(exc).__name__}: {exc}"],
        }
    return json.dumps(result)


def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    revision = int(payload.get("revision", 0) or 0)
    if not payload.get("isAutonomous", True) or payload.get("mode") == "non_autonomous":
        return _empty(revision, ["Symbolic analysis skipped for non-autonomous systems."])

    warnings: list[str] = []
    parsed = _parse_system(payload, warnings)
    if parsed is None:
        return _empty(revision, warnings or ["The vector field could not be parsed."])
    if parsed["explicit_time"]:
        return _empty(revision, ["Symbolic analysis skipped for non-autonomous systems."])

    f: sp.Matrix = parsed["f"]
    variables: list[sp.Symbol] = parsed["variables"]
    names: list[str] = parsed["names"]
    dimension = len(variables)

    global_props: dict[str, Any] = {}
    try:
        _fill_global_algebra(global_props, f, variables, names, bool(payload.get("isLinear")))
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Global algebra failed: {exc}")

    equilibria: list[dict[str, Any]] = []
    try:
        equilibria = _solve_equilibria(f, variables, warnings)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Equilibrium solver failed: {exc}")

    patches: list[dict[str, Any]] = []
    series: list[dict[str, Any]] = []
    analyzed: list[dict[str, Any]] = []
    reversible_axes = _reversible_axes(global_props.get("symmetries", []))
    for index, eq in enumerate(equilibria):
        try:
            patch, jets, summary = _analyze_equilibrium(
                f,
                variables,
                names,
                eq,
                hamiltonian=bool(global_props.get("isHamiltonian")),
                reversible_axes=reversible_axes,
            )
            patches.append(patch)
            series.extend(jets)
            analyzed.append(summary)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Equilibrium {index} failed: {exc}")

    try:
        transforms = _coordinate_transforms(f, variables, names, analyzed)
        if transforms:
            global_props_transforms = transforms
        else:
            global_props_transforms = None
    except Exception as exc:  # noqa: BLE001
        global_props_transforms = None
        warnings.append(f"Coordinate transforms failed: {exc}")

    try:
        lyapunov = _lyapunov(
            f,
            variables,
            names,
            analyzed,
            payload.get("userLyapunovExpr") or "",
            global_props.get("hamiltonianExpr"),
            global_props.get("hamiltonianLatex"),
            warnings,
        )
        if lyapunov:
            global_props["lyapunov"] = lyapunov
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Lyapunov analysis failed: {exc}")

    if dimension == 2:
        try:
            dulac = _bendixson(f, variables[0], variables[1])
            if dulac:
                global_props["bendixsonDulac"] = dulac
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"Bendixson–Dulac test failed: {exc}")

    result: dict[str, Any] = {
        "revision": revision,
        "equilibriaPatches": patches,
        "manifoldSeries": series,
    }
    if global_props_transforms:
        result["coordinateTransforms"] = global_props_transforms
    if global_props:
        result["global"] = global_props
    if warnings:
        result["warnings"] = warnings
    return result


def _empty(revision: int, warnings: list[str]) -> dict[str, Any]:
    result: dict[str, Any] = {"revision": revision, "equilibriaPatches": [], "manifoldSeries": []}
    if warnings:
        result["warnings"] = warnings
    return result


def _parse_system(payload: dict[str, Any], warnings: list[str]) -> dict[str, Any] | None:
    names = [str(name) for name in payload.get("stateVars") or []]
    rhs_raw = [str(item) for item in payload.get("rhsExpressions") or []]
    if not names or len(names) != len(rhs_raw):
        warnings.append("State variables and right-hand sides do not match.")
        return None
    variables = [sp.Symbol(name, real=True) for name in names]
    parameters = payload.get("parameters") or {}
    parameter_symbols = {str(name): sp.Symbol(str(name), real=True) for name in parameters}
    local_dict: dict[str, Any] = {
        "sin": sp.sin,
        "cos": sp.cos,
        "tan": sp.tan,
        "exp": sp.exp,
        "log": sp.log,
        "ln": sp.log,
        "sqrt": sp.sqrt,
        "abs": sp.Abs,
        "pi": sp.pi,
        "e": sp.E,
        "E": sp.E,
        "sinh": sp.sinh,
        "cosh": sp.cosh,
        "tanh": sp.tanh,
        "asin": sp.asin,
        "acos": sp.acos,
        "atan": sp.atan,
        "atan2": sp.atan2,
    }
    local_dict.update({symbol.name: symbol for symbol in variables})
    local_dict.update({symbol.name: symbol for symbol in parameter_symbols.values()})
    expressions: list[sp.Expr] = []
    for raw in rhs_raw:
        expressions.append(sp.sympify(_clean_rhs(raw), locals=local_dict))
    subs = {parameter_symbols[name]: _rationalize(value) for name, value in parameters.items() if name in parameter_symbols}
    f = sp.Matrix(
        [sp.nsimplify(sp.simplify(expr.subs(subs)), rational=True, tolerance=1e-9) for expr in expressions]
    )
    time_name = str(payload.get("independentVar") or "t")
    explicit_time = time_name not in names and any(getattr(symbol, "name", "") == time_name for symbol in f.free_symbols)
    return {"f": f, "variables": variables, "names": names, "explicit_time": explicit_time}


def _clean_rhs(text: str) -> str:
    cleaned = text.strip()
    if "=" in cleaned:
        cleaned = cleaned.split("=")[-1]
    for source, target in {
        "−": "-",
        "–": "-",
        "—": "-",
        "×": "*",
        "·": "*",
        "π": "pi",
        "θ": "theta",
        "μ": "mu",
    }.items():
        cleaned = cleaned.replace(source, target)
    return cleaned.replace("^", "**")


def _rationalize(value: Any) -> sp.Expr:
    try:
        return sp.nsimplify(value, rational=True, tolerance=1e-6)
    except Exception:
        return sp.Float(value)


def is_zero(expr: sp.Expr) -> bool:
    if isinstance(expr, sp.MatrixBase):
        return all(is_zero(entry) for entry in expr)
    if expr == 0:
        return True
    expanded = sp.expand(expr)
    if expanded == 0:
        return True
    try:
        return bool(sp.simplify(expanded) == 0)
    except Exception:
        return False


def _to_float(expr: sp.Expr) -> float:
    value = complex(sp.N(sp.simplify(expr), 25))
    if abs(value.imag) > 1e-7:
        raise ValueError(f"non-real value {expr}")
    real = float(value.real)
    return 0.0 if abs(real) < 1e-12 else real


def lx(expr: sp.Expr) -> str:
    try:
        rendered = sp.latex(sp.simplify(expr))
    except Exception:
        rendered = sp.latex(expr)
    return rendered.replace(" ", "")


def _coord_shift(name: str, origin: sp.Expr) -> str:
    """Latex for a coordinate measured from an equilibrium, parenthesized when shifted."""
    if is_zero(origin):
        return name
    return rf"\left({lx(sp.Symbol(name) - origin)}\right)"


def _exact_number(expr: sp.Expr) -> dict[str, Any]:
    simplified = sp.simplify(expr)
    return {"value": _to_float(simplified), "exactLatex": lx(simplified)}


def _mathjs(expr: sp.Expr, rename: list[tuple[sp.Symbol, str]] | None = None) -> str:
    current: sp.Expr = expr
    placeholders: list[tuple[str, str]] = []
    if rename:
        for index, (symbol, token) in enumerate(rename):
            placeholder = sp.Symbol(f"zzcas{index}")
            current = current.subs(symbol, placeholder)
            placeholders.append((placeholder.name, token))
    current = sp.simplify(current)
    text = sp.sstr(current).replace("**", "^").replace("Abs(", "abs(")
    for placeholder, token in placeholders:
        text = text.replace(placeholder, token)
    return text


def _greek_latex(text: str) -> str:
    text = re.sub(r"(?<!\\)theta", r"\\theta", text)
    text = re.sub(r"(?<!\\)phi", r"\\phi", text)
    text = re.sub(r"(?<!\\)rho", r"\\rho", text)
    return text


def _is_one(expr: sp.Expr) -> bool:
    simplified = sp.simplify(expr)
    if simplified == 1:
        return True
    rendered = lx(simplified)
    if rendered in {"1", "1.0", "+1"}:
        return True
    try:
        value = complex(simplified.evalf(20))
        return abs(value.real - 1) < 1e-9 and abs(value.imag) < 1e-9
    except Exception:
        return False


def _unit_coefficient(coeff: sp.Expr) -> str:
    simplified = sp.simplify(coeff)
    if _is_one(simplified):
        return ""
    if _is_one(-simplified):
        return "-"
    return lx(simplified)


def _negative(coeff: sp.Expr) -> bool:
    simplified = sp.simplify(coeff)
    if simplified.is_negative:
        return True
    if simplified.is_positive or simplified == 0:
        return False
    try:
        return float(sp.re(simplified.evalf())) < 0
    except Exception:
        return False


def _poly_latex(expr: sp.Expr, var: sp.Symbol, atom: str) -> str:
    expanded = sp.expand(expr)
    if expanded == 0:
        return "0"
    try:
        polynomial = sp.Poly(sp.together(expanded), var)
    except Exception:
        return lx(expanded).replace(lx(var), atom)
    pieces: list[tuple[str, str]] = []
    for exponents, coeff in sorted(polynomial.terms(), key=lambda item: item[0][0], reverse=True):
        coeff = sp.simplify(coeff)
        if coeff == 0:
            continue
        sign = "-" if _negative(coeff) else "+"
        magnitude = sp.simplify(-coeff if sign == "-" else coeff)
        power = exponents[0]
        if power == 0:
            body = lx(magnitude)
        elif _is_one(magnitude):
            body = atom if power == 1 else f"{atom}^{{{power}}}"
        else:
            variable = atom if power == 1 else f"{atom}^{{{power}}}"
            body = f"{lx(magnitude)}{variable}"
        pieces.append((sign, body))
    if not pieces:
        return "0"
    rendered = pieces[0][1] if pieces[0][0] == "+" else f"-{pieces[0][1]}"
    for sign, body in pieces[1:]:
        rendered += f"{sign}{body}"
    return rendered


def _column_latex(vector: sp.Matrix) -> str:
    entries = " \\\\ ".join(lx(entry) for entry in vector)
    return rf"\begin{{pmatrix}} {entries} \end{{pmatrix}}"


def _solve_equilibria(f: sp.Matrix, variables: list[sp.Symbol], warnings: list[str]) -> list[dict[str, Any]]:
    equations = list(f)
    if all(is_zero(eq) for eq in equations):
        return [{"coords": [sp.Integer(0) for _ in variables], "family": rf"x \in \mathbb{{R}}^{{{len(variables)}}}", "isolated": False}]
    rewritten, unknowns, trig_pairs = _trig_substitute(equations, variables)
    if len(unknowns) > 8:
        warnings.append("Too many unknowns for the exact solver.")
        return []
    if any(eq.is_polynomial(*unknowns) and sp.total_degree(eq, *unknowns) > SOLVE_DEGREE_LIMIT for eq in rewritten):
        warnings.append("Polynomial degree exceeds the exact-solver limit.")
        return []
    try:
        solutions = sp.solve(rewritten, unknowns, dict=True)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"solve failed: {exc}")
        solutions = []
    if not solutions and all(eq.is_polynomial(*unknowns) for eq in rewritten):
        try:
            basis = sp.groebner(rewritten, *unknowns, order="lex")
            solutions = sp.solve(list(basis), unknowns, dict=True)
        except Exception:
            solutions = []
    points: list[dict[str, Any]] = []
    for solution in solutions:
        if not isinstance(solution, dict):
            continue
        realized = _realize_solution(solution, variables, trig_pairs)
        points.extend(realized)
    unique: list[dict[str, Any]] = []
    seen: set[tuple[float, ...]] = set()
    for point in points:
        try:
            key = tuple(round(_to_float(coord), 8) for coord in point["coords"])
        except Exception:
            continue
        if key in seen:
            continue
        seen.add(key)
        unique.append(point)
        if len(unique) >= 16:
            break
    return unique


def _trig_substitute(
    equations: list[sp.Expr], variables: list[sp.Symbol]
) -> tuple[list[sp.Expr], list[sp.Symbol], list[tuple[sp.Symbol, sp.Symbol, sp.Symbol]]]:
    pairs: list[tuple[sp.Symbol, sp.Symbol, sp.Symbol]] = []
    current = list(equations)
    for var in variables:
        if not any(expr.has(sp.sin(var)) or expr.has(sp.cos(var)) for expr in current):
            continue
        sine = sp.Symbol(f"s_{var.name}", real=True)
        cosine = sp.Symbol(f"c_{var.name}", real=True)
        pairs.append((var, sine, cosine))
        current = [expr.subs(sp.sin(var), sine).subs(sp.cos(var), cosine) for expr in current]
        current.append(sine**2 + cosine**2 - 1)
    unknowns: list[sp.Symbol] = []
    replaced = {var for var, _sine, _cosine in pairs}
    for var in variables:
        if var not in replaced and any(expr.has(var) for expr in current):
            unknowns.append(var)
    for _var, sine, cosine in pairs:
        unknowns.extend([sine, cosine])
    return current, unknowns, pairs


def _angle_base(sine: sp.Expr, cosine: sp.Expr) -> sp.Expr:
    sine_value = sp.simplify(sine)
    cosine_value = sp.simplify(cosine)
    if sine_value == 0 and cosine_value == 1:
        return sp.Integer(0)
    if sine_value == 0 and cosine_value == -1:
        return sp.pi
    return sp.atan2(sine_value, cosine_value)


def _realize_solution(
    solution: dict[sp.Symbol, sp.Expr],
    variables: list[sp.Symbol],
    trig_pairs: list[tuple[sp.Symbol, sp.Symbol, sp.Symbol]],
) -> list[dict[str, Any]]:
    trig_of = {var: (sine, cosine) for var, sine, cosine in trig_pairs}
    bases: list[sp.Expr | None] = []
    periodic: list[bool] = []
    free: list[bool] = []
    for var in variables:
        if var in trig_of:
            sine, cosine = trig_of[var]
            if sine not in solution or cosine not in solution:
                bases.append(None)
                periodic.append(False)
                free.append(True)
                continue
            bases.append(_angle_base(solution[sine], solution[cosine]))
            periodic.append(True)
            free.append(False)
            continue
        if var not in solution or solution[var].free_symbols:
            bases.append(sp.Integer(0) if var not in solution or solution[var].free_symbols else solution[var])
            periodic.append(False)
            free.append(True)
            continue
        value = sp.simplify(solution[var])
        if value.free_symbols or not _is_real_expr(value):
            return []
        bases.append(value)
        periodic.append(False)
        free.append(False)
    if any(not _is_real_expr(base) for base, is_free in zip(bases, free) if base is not None and not is_free):
        return []
    family = _family_latex(variables, bases, periodic, free)
    # A periodic coordinate still has isolated zeros; only a free parameter is a continuum.
    isolated = not any(free)
    offsets = [0]
    if any(periodic):
        offsets = [-2, -1, 0, 1, 2]
    points: list[dict[str, Any]] = []
    windows = offsets or [0]
    choices = product(windows, repeat=max(1, sum(1 for flag in periodic if flag)))
    for choice in choices:
        cursor = 0
        coords: list[sp.Expr] = []
        keep = True
        for base, is_periodic, is_free in zip(bases, periodic, free):
            if is_free:
                coords.append(sp.Integer(0))
                continue
            assert base is not None
            if is_periodic:
                shift = base + 2 * sp.pi * choice[cursor]
                cursor += 1
                try:
                    # Keep one fundamental period: -π, 0, π for the pendulum, not ±2π.
                    if abs(_to_float(shift)) >= 2 * float(sp.pi) - 1e-6:
                        keep = False
                        break
                except Exception:
                    keep = False
                    break
                coords.append(sp.simplify(shift))
            else:
                coords.append(base)
        if not keep:
            continue
        points.append({"coords": coords, "family": family, "isolated": isolated})
    if not points and not any(periodic):
        points.append({"coords": [base if base is not None else sp.Integer(0) for base in bases], "family": family, "isolated": isolated})
    return points


def _is_real_expr(expr: sp.Expr) -> bool:
    if expr.is_real:
        return True
    try:
        value = complex(expr.evalf())
    except Exception:
        return False
    return abs(value.imag) < 1e-7


def _family_latex(
    variables: list[sp.Symbol],
    bases: list[sp.Expr | None],
    periodic: list[bool],
    free: list[bool],
) -> str | None:
    if not any(periodic) and not any(free):
        return None
    parts: list[str] = []
    for base, is_periodic, is_free in zip(bases, periodic, free):
        if is_free:
            parts.append("C")
        elif is_periodic and base == 0:
            parts.append(r"2k\pi")
        elif is_periodic and sp.simplify(base - sp.pi) == 0:
            parts.append(r"(2k+1)\pi")
        elif is_periodic and base is not None:
            parts.append(lx(base) + r"+2k\pi")
        elif base is not None:
            parts.append(lx(base))
        else:
            parts.append("C")
    qualifier = r",\ k\in\mathbb{Z}" if any(periodic) else r",\ C\in\mathbb{R}"
    return r"\left(" + ", ".join(parts) + r"\right)" + qualifier


def _fill_global_algebra(
    target: dict[str, Any],
    f: sp.Matrix,
    variables: list[sp.Symbol],
    names: list[str],
    is_linear: bool,
) -> None:
    jacobian = sp.simplify(f.jacobian(variables))
    target["symbolicJacobianLatex"] = sp.latex(jacobian)
    divergence = sp.simplify(sum(sp.diff(f[i], variables[i]) for i in range(len(variables))))
    target["divergenceLatex"] = lx(divergence)
    target["divergenceExpr"] = _mathjs(divergence)
    target["isDivergenceFree"] = is_zero(divergence)
    hamiltonian = None
    potential = None
    if len(variables) == 2:
        curl = sp.simplify(sp.diff(f[0], variables[1]) - sp.diff(f[1], variables[0]))
        target["curl2DLatex"] = lx(curl)
        hamiltonian = _hamiltonian(f, variables[0], variables[1])
        potential = _potential(f, variables[0], variables[1], curl)
    target["isHamiltonian"] = hamiltonian is not None
    if hamiltonian is not None:
        target["hamiltonianLatex"] = lx(hamiltonian)
        target["hamiltonianExpr"] = _mathjs(hamiltonian)
    target["isGradientSystem"] = potential is not None
    if potential is not None:
        target["potentialFunctionLatex"] = lx(potential)
        target["potentialExpr"] = _mathjs(potential)
    symmetries = _symmetries(f, variables, names)
    target["symmetries"] = symmetries
    jacobian_constant = all(not jacobian.has(var) for var in variables)
    if is_linear or jacobian_constant:
        exact = _linear_exact(f, jacobian, variables)
        if exact:
            target["linearSystemExact"] = exact


def _hamiltonian(f: sp.Matrix, x: sp.Symbol, y: sp.Symbol) -> sp.Expr | None:
    if not is_zero(sp.diff(f[0], x) + sp.diff(f[1], y)):
        return None
    candidate = sp.integrate(f[0], y)
    if candidate.has(sp.Integral):
        return None
    residual = sp.simplify(sp.diff(candidate, x) + f[1])
    if residual.has(y) and not is_zero(sp.diff(residual, y)):
        return None
    if not is_zero(residual):
        correction = sp.integrate(residual, x)
        if correction.has(sp.Integral):
            return None
        candidate = sp.simplify(candidate - correction)
    if is_zero(sp.diff(candidate, y) - f[0]) and is_zero(-sp.diff(candidate, x) - f[1]):
        return sp.simplify(candidate)
    return None


def _potential(f: sp.Matrix, x: sp.Symbol, y: sp.Symbol, curl: sp.Expr) -> sp.Expr | None:
    if not is_zero(curl):
        return None
    candidate = -sp.integrate(f[0], x)
    if candidate.has(sp.Integral):
        return None
    residual = sp.simplify(sp.diff(candidate, y) + f[1])
    if residual.has(x) and not is_zero(sp.diff(residual, x)):
        return None
    if not is_zero(residual):
        correction = sp.integrate(residual, y)
        if correction.has(sp.Integral):
            return None
        candidate = sp.simplify(candidate - correction)
    if is_zero(sp.diff(candidate, x) + f[0]) and is_zero(sp.diff(candidate, y) + f[1]):
        return sp.simplify(candidate)
    return None


def _symmetries(f: sp.Matrix, variables: list[sp.Symbol], names: list[str]) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    if len(variables) < 2:
        return found
    x, y = variables[0], variables[1]
    f1, f2 = f[0], f[1]

    def both(a: sp.Expr, b: sp.Expr) -> bool:
        return is_zero(a) and is_zero(b)

    reflected_y = f.subs(y, -y)
    if both(reflected_y[0] - f1, reflected_y[1] + f2):
        found.append(
            {
                "type": "x_reflection",
                "formulaLatex": r"(x,y)\mapsto (x,-y)",
                "geometricImplication": "The phase portrait is symmetric across the x-axis.",
            }
        )
    reflected_x = f.subs(x, -x)
    if both(reflected_x[0] + f1, reflected_x[1] - f2):
        found.append(
            {
                "type": "y_reflection",
                "formulaLatex": r"(x,y)\mapsto (-x,y)",
                "geometricImplication": "The phase portrait is symmetric across the y-axis.",
            }
        )
    inverted = f.subs({x: -x, y: -y})
    if both(inverted[0] + f1, inverted[1] + f2):
        found.append(
            {
                "type": "origin_inversion",
                "formulaLatex": r"(x,y)\mapsto (-x,-y)",
                "geometricImplication": "The vector field is odd, so the portrait has half-turn symmetry.",
            }
        )
    if both(reflected_y[0] + f1, reflected_y[1] - f2):
        found.append(
            {
                "type": "time_reversible_x",
                "formulaLatex": r"(x,y,t)\mapsto (x,-y,-t)",
                "geometricImplication": "Reversible across the x-axis; a linear center on that axis is a nonlinear center.",
            }
        )
    if both(reflected_x[0] - f1, reflected_x[1] + f2):
        found.append(
            {
                "type": "time_reversible_y",
                "formulaLatex": r"(x,y,t)\mapsto (-x,y,-t)",
                "geometricImplication": "Reversible across the y-axis; a linear center on that axis is a nonlinear center.",
            }
        )
    for var, label in ((x, names[0]), (y, names[1])):
        if (f.has(sp.sin(var)) or f.has(sp.cos(var))) and is_zero(f.subs(var, var + 2 * sp.pi) - f):
            found.append(
                {
                    "type": "periodic_translation",
                    "formulaLatex": rf"({label})\mapsto ({label}+2\pi)",
                    "geometricImplication": f"The field is 2\\pi-periodic in {label}.",
                }
            )
    return found


def _reversible_axes(symmetries: list[dict[str, str]]) -> set[str]:
    axes: set[str] = set()
    for symmetry in symmetries:
        if symmetry.get("type") == "time_reversible_x":
            axes.add("x")
        if symmetry.get("type") == "time_reversible_y":
            axes.add("y")
    return axes


def _linear_exact(f: sp.Matrix, jacobian: sp.Matrix, variables: list[sp.Symbol]) -> dict[str, str] | None:
    time = sp.symbols("t", real=True)
    if jacobian.rows == 2:
        exponential = _exponential_2d(jacobian, time)
        jordan = _real_jordan_2d(jacobian)
    else:
        try:
            _transform, jordan_matrix = jacobian.jordan_form()
            jordan = sp.simplify(jordan_matrix)
        except Exception:
            jordan = jacobian
        try:
            exponential = sp.simplify(sp.exp(jacobian * time))
        except Exception:
            exponential = sp.eye(jacobian.rows)
    homogeneous = is_zero(f - jacobian * sp.Matrix(variables))
    general = r"x(t) = e^{At} x_{0}" if homogeneous else r"x(t) = x^{*} + e^{At}(x_{0}-x^{*})"
    return {
        "matrixALatex": sp.latex(jacobian),
        "jordanFormLatex": sp.latex(jordan),
        "matrixExponentialLatex": sp.latex(exponential),
        "generalSolutionLatex": general,
    }


def _exponential_2d(jacobian: sp.Matrix, time: sp.Symbol) -> sp.Matrix:
    trace = sp.simplify(jacobian.trace())
    discriminant = sp.factor(sp.simplify(trace**2 - 4 * jacobian.det()))
    half = trace / 2
    traceless = sp.simplify(jacobian - half * sp.eye(2))
    if is_zero(discriminant):
        return sp.simplify(sp.exp(half * time) * (sp.eye(2) + time * traceless))
    gap = sp.sqrt(sp.factor(-discriminant if _negative(discriminant) else discriminant)) / 2
    if _negative(discriminant):
        return sp.simplify(sp.exp(half * time) * (sp.cos(gap * time) * sp.eye(2) + sp.sin(gap * time) / gap * traceless))
    return sp.simplify(sp.exp(half * time) * (sp.cosh(gap * time) * sp.eye(2) + sp.sinh(gap * time) / gap * traceless))


def _real_jordan_2d(jacobian: sp.Matrix) -> sp.Matrix:
    trace = sp.simplify(jacobian.trace())
    discriminant = sp.factor(sp.simplify(trace**2 - 4 * jacobian.det()))
    half = trace / 2
    if is_zero(discriminant):
        if is_zero(jacobian - half * sp.eye(2)):
            return half * sp.eye(2)
        return sp.Matrix([[half, 1], [0, half]])
    offset = sp.sqrt(discriminant) / 2
    return sp.diag(sp.simplify(half + offset), sp.simplify(half - offset))


def _collapse_angle(expr: sp.Expr, angle: sp.Symbol) -> sp.Expr:
    """Replace cos^2 = 1-sin^2. This is enough for r' = f(r) and avoids trigsimp."""
    cosine = sp.cos(angle)
    collapsed = sp.expand(expr)
    if not collapsed.has(cosine):
        return collapsed
    collapsed = sp.expand(collapsed.subs(cosine**2, 1 - sp.sin(angle) ** 2))
    if collapsed.has(cosine):
        collapsed = sp.expand(collapsed.subs(cosine**2, 1 - sp.sin(angle) ** 2))
    return collapsed


def _radial_leading(f: sp.Matrix, x: sp.Symbol, y: sp.Symbol) -> tuple[int, sp.Expr] | None:
    radius = sp.symbols("r", real=True)
    angle = sp.symbols("theta", real=True)
    radial = sp.expand(((x * f[0] + y * f[1]) / radius).subs({x: radius * sp.cos(angle), y: radius * sp.sin(angle)}))
    radial = _collapse_angle(radial, angle)
    if not is_zero(sp.diff(radial, angle)):
        return None
    series = sp.series(sp.expand(radial), radius, 0, 7).removeO()
    for power in range(1, 7):
        coeff = sp.simplify(sp.expand(series).coeff(radius, power))
        if not is_zero(coeff):
            return power, coeff
    return None


def _analyze_equilibrium(
    f: sp.Matrix,
    variables: list[sp.Symbol],
    names: list[str],
    eq: dict[str, Any],
    hamiltonian: bool,
    reversible_axes: set[str],
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    origin = sp.Matrix(eq["coords"])
    jacobian = sp.simplify(f.jacobian(variables).subs(dict(zip(variables, origin))))
    jacobian = jacobian.applyfunc(lambda entry: sp.nsimplify(entry, rational=True, tolerance=1e-9) if entry.is_number else sp.simplify(entry))
    modes = _modes(jacobian)
    eigenvalues, subspaces = _package_spectrum(modes, origin, names)
    higher_vanishes = _higher_jet_vanishes(f, variables, origin, jacobian)
    on_axis = False
    if len(origin) >= 2:
        if "x" in reversible_axes and is_zero(origin[1]):
            on_axis = True
        if "y" in reversible_axes and is_zero(origin[0]):
            on_axis = True
    classification, stability, reason, l1 = _classify(
        modes,
        jacobian,
        f,
        variables,
        origin,
        higher_vanishes=higher_vanishes,
        hamiltonian=hamiltonian,
        reversible_center=on_axis,
        isolated=bool(eq.get("isolated", True)),
    )
    jets: list[dict[str, Any]] = []
    if len(variables) in (2, 3) and modes:
        jets, reduction = _manifolds(f, variables, names, origin, modes, l1)
        if reduction:
            stability = reduction["stability"]
            reason = reduction["reason"]
            if reduction.get("classification"):
                classification = reduction["classification"]
    elif l1 is not None and l1 != 0 and len(variables) == 2:
        jets.append(_focus_normal_form(origin, names, l1))

    match = [_to_float(coord) for coord in origin]
    patch: dict[str, Any] = {
        "matchCoords": match,
        "coordsExactLatex": [lx(coord) for coord in origin],
        "sourceMethod": "exact_sympy",
        "jacobianExactLatex": sp.latex(jacobian),
        "trace": _exact_number(jacobian.trace()),
        "determinant": _exact_number(jacobian.det()),
        "eigenvalues": eigenvalues,
        "subspaces": subspaces,
        "stability": stability,
        "stabilityReasonLatex": reason,
    }
    if eq.get("family"):
        patch["familyFormulaLatex"] = eq["family"]
    if len(variables) == 2:
        patch["discriminant2D"] = _exact_number(sp.simplify(jacobian.trace() ** 2 - 4 * jacobian.det()))
    if classification and len(variables) == 2:
        patch["classification2D"] = classification
    if classification and len(variables) == 3:
        patch["classification3D"] = classification
    summary = {
        "coords": match,
        "classification": classification,
        "realParts": [_to_float(mode["re"]) for mode in modes],
        "imagParts": [_to_float(mode["im"]) for mode in modes],
    }
    return patch, jets, summary


def _higher_jet_vanishes(f: sp.Matrix, variables: list[sp.Symbol], origin: sp.Matrix, jacobian: sp.Matrix) -> bool:
    displacement = sp.Matrix(variables) - origin
    remainder = sp.simplify(f - jacobian * displacement)
    return all(is_zero(entry) for entry in remainder)


def _scale_real(vector: sp.Matrix) -> sp.Matrix:
    vector = sp.Matrix([sp.simplify(entry) for entry in vector])
    for entry in vector:
        if not is_zero(entry):
            return sp.Matrix([sp.simplify(component / entry) for component in vector])
    return vector


def _normalize_complex(vector: sp.Matrix) -> sp.Matrix:
    best = None
    best_abs = -1.0
    for entry in vector:
        magnitude = abs(complex(entry.evalf()))
        if magnitude > best_abs:
            best_abs = magnitude
            best = entry
    if best is None or best_abs < 1e-12:
        return vector
    return sp.Matrix([sp.simplify(entry / best) for entry in vector])


def _modes(jacobian: sp.Matrix) -> list[dict[str, Any]]:
    modes: list[dict[str, Any]] = []
    for value, multiplicity, vectors in jacobian.eigenvects():
        value = sp.simplify(value)
        real_part = sp.simplify(sp.re(value))
        imag_part = sp.simplify(sp.im(value))
        imag_number = _to_float(imag_part) if imag_part.is_number or imag_part.is_real else _to_float(imag_part)
        if abs(imag_number) < 1e-8:
            real_vectors = []
            for vector in vectors:
                cleaned = sp.Matrix([sp.simplify(sp.re(entry)) for entry in vector])
                real_vectors.append(_scale_real(cleaned))
            modes.append(
                {
                    "re": real_part,
                    "im": sp.Integer(0),
                    "mult": int(multiplicity),
                    "vectors": real_vectors,
                    "exact": sp.simplify(sp.re(value)),
                }
            )
            continue
        if imag_number < 0:
            continue
        for vector in vectors:
            normalized = _normalize_complex(sp.Matrix(vector))
            real_vector = sp.Matrix([sp.simplify(sp.re(entry)) for entry in normalized])
            imag_vector = sp.Matrix([sp.simplify(sp.im(entry)) for entry in normalized])
            modes.append(
                {
                    "re": real_part,
                    "im": sp.simplify(sp.Abs(imag_part)),
                    "mult": 1,
                    "vectors": [real_vector, imag_vector],
                    "exact": sp.simplify(value),
                    "exactConjugate": sp.simplify(sp.conjugate(value)),
                }
            )
    kind_order = {"Es": 0, "Ec": 1, "Eu": 2}
    modes.sort(key=lambda mode: (kind_order[_kind(mode["re"])], _to_float(mode["re"]), -_to_float(mode["im"])))
    return modes


def _kind(real_part: sp.Expr) -> str:
    value = _to_float(real_part)
    if value < -1e-8:
        return "Es"
    if value > 1e-8:
        return "Eu"
    return "Ec"


def _package_spectrum(
    modes: list[dict[str, Any]], origin: sp.Matrix, names: list[str]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    eigenvalues: list[dict[str, Any]] = []
    grouped: dict[str, list[sp.Matrix]] = {"Es": [], "Ec": [], "Eu": []}
    for mode in modes:
        kind = _kind(mode["re"])
        grouped[kind].extend(mode["vectors"])
        if is_zero(mode["im"]):
            if len(mode["vectors"]) == mode["mult"]:
                for _vector in mode["vectors"]:
                    eigenvalues.append(_eigen_record(mode["re"], 0, 1, mode["exact"]))
            else:
                eigenvalues.append(_eigen_record(mode["re"], 0, mode["mult"], mode["exact"]))
        else:
            eigenvalues.append(_eigen_record(mode["re"], mode["im"], 1, mode["exact"]))
            eigenvalues.append(_eigen_record(mode["re"], -mode["im"], 1, mode["exactConjugate"]))
    subspaces = []
    for kind in ("Es", "Ec", "Eu"):
        vectors = grouped[kind]
        if not vectors:
            continue
        subspaces.append(_subspace(kind, vectors, origin, names))
    return eigenvalues, subspaces


def _eigen_record(real_part: sp.Expr, imag_part: sp.Expr, multiplicity: int, exact: sp.Expr) -> dict[str, Any]:
    return {
        "re": _to_float(real_part),
        "im": _to_float(imag_part),
        "multiplicity": multiplicity,
        "exactLatex": lx(exact),
    }


def _subspace(kind: str, vectors: list[sp.Matrix], origin: sp.Matrix, names: list[str]) -> dict[str, Any]:
    letter = {"Es": "s", "Eu": "u", "Ec": "c"}[kind]
    prefix = f"E^{{{letter}}}"
    dimension = len(names)
    formula = _cartesian_formula(prefix, vectors, origin, names)
    return {
        "kind": kind,
        "dimension": len(vectors),
        "basisVectors": [[_to_float(entry) for entry in vector] for vector in vectors],
        "basisExactLatex": [_column_latex(vector) for vector in vectors],
        "cartesianFormulaLatex": formula if formula else f"{prefix} \\subset \\mathbb{{R}}^{{{dimension}}}",
    }


def _cartesian_formula(prefix: str, vectors: list[sp.Matrix], origin: sp.Matrix, names: list[str]) -> str:
    dimension = len(names)
    if len(vectors) == dimension:
        return rf"{prefix}=\mathbb{{R}}^{{{dimension}}}"
    if dimension == 2 and len(vectors) == 1:
        direction = vectors[0]
        if is_zero(direction[0]):
            return rf"{prefix}: {names[0]}={lx(origin[0])}"
        if is_zero(direction[1]):
            return rf"{prefix}: {names[1]}={lx(origin[1])}"
        slope = sp.simplify(direction[1] / direction[0])
        return rf"{prefix}: {_coord_shift(names[1], origin[1])}={_unit_coefficient(slope)}{_coord_shift(names[0], origin[0])}"
    if dimension == 3 and len(vectors) == 2:
        normal = vectors[0].cross(vectors[1])
        terms = []
        for component, name, star in zip(normal, names, origin):
            if is_zero(component):
                continue
            terms.append(rf"{_unit_coefficient(component)}\left({name}-{lx(star)}\right)")
        equation = "+".join(terms) if terms else "0"
        return rf"{prefix}: {equation}=0"
    if len(vectors) == 1:
        pieces = []
        for component, name, star in zip(vectors[0], names, origin):
            coeff = _unit_coefficient(component)
            if coeff == "-":
                term = "-t"
            elif coeff == "":
                term = "+t"
            else:
                term = f"+{coeff}t"
            pieces.append(rf"{name}={lx(star)}{term}")
        return rf"{prefix}: " + ", ".join(pieces)
    basis = ", ".join(_column_latex(vector) for vector in vectors)
    return rf"{prefix}={lx(sp.Matrix(origin))}+\mathrm{{span}}\{{{basis}\}}"


def _classify(
    modes: list[dict[str, Any]],
    jacobian: sp.Matrix,
    f: sp.Matrix,
    variables: list[sp.Symbol],
    origin: sp.Matrix,
    higher_vanishes: bool,
    hamiltonian: bool,
    reversible_center: bool,
    isolated: bool,
) -> tuple[str | None, str, str, sp.Expr | None]:
    if not isolated:
        return "non_isolated_line", "undetermined", "The equilibrium is not isolated.", None
    if not modes:
        return None, "undetermined", "The spectrum could not be computed.", None
    real_parts = [_to_float(mode["re"]) for mode in modes]
    imag_parts = [_to_float(mode["im"]) for mode in modes]
    dimension = jacobian.rows
    if dimension == 1:
        slope = real_parts[0]
        if slope < -1e-8:
            return None, "asymptotically_stable", "The derivative is negative, so the equilibrium is asymptotically stable.", None
        if slope > 1e-8:
            return None, "unstable", "The derivative is positive, so the equilibrium is unstable.", None
        return None, "undetermined", "The derivative vanishes, so linearization is inconclusive.", None
    if dimension >= 4:
        return _stability_from_parts(real_parts)
    if dimension == 3:
        return (*_classify_3d(modes), None)
    return _classify_2d(
        modes,
        jacobian,
        f,
        variables,
        origin,
        real_parts,
        imag_parts,
        higher_vanishes,
        hamiltonian,
        reversible_center,
    )


def _stability_from_parts(real_parts: list[float]) -> tuple[None, str, str, None]:
    if any(part > 1e-8 for part in real_parts):
        return None, "unstable", "Some eigenvalue has positive real part.", None
    if all(part < -1e-8 for part in real_parts):
        return None, "asymptotically_stable", "Every eigenvalue has negative real part.", None
    return None, "undetermined", "A center direction is present, so linearization is inconclusive.", None


def _classify_3d(modes: list[dict[str, Any]]) -> tuple[str, str, str]:
    real_negative = 0
    real_positive = 0
    complex: list[tuple[float, float]] = []
    zero = False
    for mode in modes:
        real_part = _to_float(mode["re"])
        imag_part = _to_float(mode["im"])
        if abs(real_part) <= 1e-8:
            zero = True
        if abs(imag_part) > 1e-8:
            complex.append((real_part, imag_part))
            continue
        if real_part < -1e-8:
            real_negative += mode["mult"]
        elif real_part > 1e-8:
            real_positive += mode["mult"]
    if zero:
        return "center_manifold_3d", "undetermined", "A zero-real-part eigenvalue makes the equilibrium non-hyperbolic."
    if complex:
        cre = complex[0][0]
        if cre < -1e-8 and real_positive == 1 and real_negative == 0:
            return "saddle_focus_1_2", "unstable", "One real unstable eigenvalue and a stable focus plane."
        if cre > 1e-8 and real_negative == 1 and real_positive == 0:
            return "saddle_focus_2_1", "unstable", "A real stable eigenvalue and an unstable focus plane."
        if cre < -1e-8 and real_positive == 0:
            return "stable_focus_node", "asymptotically_stable", "The spectrum is a stable focus plus a stable real eigenvalue."
        if cre > 1e-8 and real_negative == 0:
            return "unstable_focus_node", "unstable", "The spectrum is an unstable focus plus an unstable real eigenvalue."
    if real_positive == 0 and real_negative > 0:
        return "stable_node_3d", "asymptotically_stable", "Every eigenvalue is real and negative."
    if real_negative == 0 and real_positive > 0:
        return "unstable_node_3d", "unstable", "Every eigenvalue is real and positive."
    if real_positive == 1 and real_negative == 2:
        return "saddle_index_1", "unstable", "The unstable manifold is one-dimensional and the stable manifold is two-dimensional."
    if real_positive == 2 and real_negative == 1:
        return "saddle_index_2", "unstable", "The unstable manifold is two-dimensional and the stable manifold is one-dimensional."
    return "higher_dim_equilibrium", "undetermined", "The 3D spectrum does not match a standard elementary class."


def _classify_2d(
    modes: list[dict[str, Any]],
    jacobian: sp.Matrix,
    f: sp.Matrix,
    variables: list[sp.Symbol],
    origin: sp.Matrix,
    real_parts: list[float],
    imag_parts: list[float],
    higher_vanishes: bool,
    hamiltonian: bool,
    reversible_center: bool,
) -> tuple[str | None, str, str, sp.Expr | None]:
    pure_imaginary = all(abs(part) <= 1e-8 for part in real_parts) and any(abs(part) > 1e-8 for part in imag_parts)
    all_zero = all(abs(part) <= 1e-8 for part in real_parts) and all(abs(part) <= 1e-8 for part in imag_parts)
    has_zero = any(abs(part) <= 1e-8 for part in real_parts) and not pure_imaginary
    if all_zero:
        cusp = _nilpotent_cusp(jacobian, f, variables, origin)
        if cusp:
            return "cusp", "unstable", "The linear part is nilpotent and the quadratic jet is a cusp.", None
        return None, "undetermined", "Both eigenvalues vanish, so the equilibrium needs a nilpotent normal form.", None
    if pure_imaginary:
        return _classify_center(modes, f, variables, origin, higher_vanishes, hamiltonian, reversible_center)
    if has_zero:
        return None, "undetermined", "A zero eigenvalue makes the equilibrium non-hyperbolic; the center manifold decides stability.", None
    if any(abs(part) > 1e-8 for part in imag_parts):
        stable = real_parts[0] < 0
        kind = "stable_focus" if stable else "unstable_focus"
        verdict = "asymptotically_stable" if stable else "unstable"
        return kind, verdict, "The eigenvalues are a complex conjugate pair with nonzero real part.", None
    if any(part > 1e-8 for part in real_parts) and any(part < -1e-8 for part in real_parts):
        return "saddle", "unstable", "The eigenvalues are real and of opposite sign.", None
    stable = all(part < 0 for part in real_parts)
    prefix = "stable" if stable else "unstable"
    verdict = "asymptotically_stable" if stable else "unstable"
    repeated = len({round(part, 8) for part in real_parts}) == 1
    diagonalizable = all(len(mode["vectors"]) >= mode["mult"] for mode in modes)
    if repeated and not diagonalizable:
        return f"{prefix}_degenerate_node", verdict, "There is a repeated eigenvalue with a single eigenvector (a Jordan block).", None
    if repeated:
        return f"{prefix}_proper_node", verdict, "There is a repeated eigenvalue with a full eigenbasis (a star node).", None
    return f"{prefix}_improper_node", verdict, "The eigenvalues are real, distinct, and of the same sign.", None


def _classify_center(
    modes: list[dict[str, Any]],
    f: sp.Matrix,
    variables: list[sp.Symbol],
    origin: sp.Matrix,
    higher_vanishes: bool,
    hamiltonian: bool,
    reversible_center: bool,
) -> tuple[str, str, str, sp.Expr | None]:
    if higher_vanishes:
        return "linear_center", "lyapunov_stable", "The linearization is a center and there are no higher-order terms.", sp.Integer(0)
    if hamiltonian:
        return "nonlinear_center", "lyapunov_stable", "The linearization is a center and the system is Hamiltonian, so the equilibrium is a nonlinear center.", sp.Integer(0)
    if reversible_center:
        return "nonlinear_center", "lyapunov_stable", "The equilibrium lies on the fixed axis of a reversibility and is a linear center, hence a nonlinear center.", sp.Integer(0)
    radial = _radial_leading(f, variables[0], variables[1])
    if radial is not None:
        power, coeff = radial
        if power >= 3 and power % 2 == 1 and _negative(coeff):
            return "weak_stable_focus", "asymptotically_stable", rf"In polar coordinates the radial equation starts with ${_unit_coefficient(coeff)} r^{{{power}}}$, so the focus is weakly attracting.", coeff
        if power >= 3 and power % 2 == 1 and not _negative(coeff) and not is_zero(coeff):
            return "weak_unstable_focus", "unstable", rf"In polar coordinates the radial equation starts with ${_unit_coefficient(coeff)} r^{{{power}}}$, so the focus is weakly repelling.", coeff
        if power % 2 == 0:
            return None, "undetermined", "The radial equation has an even leading power, so the equilibrium is not a standard weak focus.", coeff
    l1 = _lyapunov_coefficient(f, variables, origin, modes)
    if l1 is None:
        return None, "undetermined", "The linearization is a center, but the first Lyapunov coefficient was not computed.", None
    if is_zero(l1):
        return None, "undetermined", "The first Lyapunov coefficient vanishes, so a higher-order focal value is required.", l1
    if _negative(l1):
        return "weak_stable_focus", "asymptotically_stable", rf"The first Lyapunov coefficient is ${lx(l1)}<0$, so the linear center is a weak stable focus.", l1
    return "weak_unstable_focus", "unstable", rf"The first Lyapunov coefficient is ${lx(l1)}>0$, so the linear center is a weak unstable focus.", l1


def _nilpotent_cusp(jacobian: sp.Matrix, f: sp.Matrix, variables: list[sp.Symbol], origin: sp.Matrix) -> bool:
    if jacobian.shape != (2, 2) or is_zero(jacobian) or not is_zero(jacobian**2):
        return False
    try:
        kernel = jacobian.nullspace()
        if len(kernel) != 1:
            return False
        solvable, _params = jacobian.gauss_jordan_solve(kernel[0])
        generalized = sp.Matrix([sp.simplify(entry.subs({symbol: 0 for symbol in entry.free_symbols})) for entry in solvable])
        basis = kernel[0].row_join(generalized)
        if is_zero(basis.det()):
            basis = generalized.row_join(kernel[0])
        if is_zero(basis.det()):
            return False
        displacement = origin + basis * sp.Matrix(variables)
        transformed = sp.simplify(basis.inv() * f.subs(dict(zip(variables, displacement))))
        along_axis = sp.series(transformed[1].subs(variables[1], 0), variables[0], 0, 4).removeO()
        quadratic = sp.expand(along_axis).coeff(variables[0], 2)
        return not is_zero(quadratic)
    except Exception:
        return False


def _lyapunov_coefficient(
    f: sp.Matrix, variables: list[sp.Symbol], origin: sp.Matrix, modes: list[dict[str, Any]]
) -> sp.Expr | None:
    mode = next((item for item in modes if abs(_to_float(item["im"])) > 1e-8 and abs(_to_float(item["re"])) <= 1e-8), None)
    if mode is None or len(mode["vectors"]) < 2:
        return None
    real_vector, imag_vector = mode["vectors"]
    omega = sp.simplify(mode["im"])
    basis = None
    for sign in (1, -1):
        candidate = (sign * imag_vector).row_join(real_vector)
        if is_zero(candidate.det()):
            continue
        similar = sp.simplify(candidate.inv() * f.jacobian(variables).subs(dict(zip(variables, origin))) * candidate)
        target = sp.Matrix([[0, -omega], [omega, 0]])
        if is_zero(similar - target):
            basis = candidate
            break
    if basis is None or is_zero(omega):
        return None
    coords = sp.Matrix(sp.symbols("X Y"))
    shifted = origin + basis * coords
    field = sp.simplify(basis.inv() * f.subs(dict(zip(variables, shifted))) / omega)
    nonlinear_x = sp.simplify(field[0] + coords[1])
    nonlinear_y = sp.simplify(field[1] - coords[0])
    x_symbol, y_symbol = coords[0], coords[1]
    zero = {x_symbol: 0, y_symbol: 0}

    def deriv(expr: sp.Expr, *orders: sp.Symbol) -> sp.Expr:
        current = expr
        for symbol in orders:
            current = sp.diff(current, symbol)
        return sp.simplify(current.subs(zero))

    px = nonlinear_x
    qx = nonlinear_y
    cubic = deriv(px, x_symbol, x_symbol, x_symbol) + deriv(px, x_symbol, y_symbol, y_symbol)
    cubic += deriv(qx, x_symbol, x_symbol, y_symbol) + deriv(qx, y_symbol, y_symbol, y_symbol)
    quadratic = deriv(px, x_symbol, y_symbol) * (deriv(px, x_symbol, x_symbol) + deriv(px, y_symbol, y_symbol))
    quadratic -= deriv(qx, x_symbol, y_symbol) * (deriv(qx, x_symbol, x_symbol) + deriv(qx, y_symbol, y_symbol))
    quadratic -= deriv(px, x_symbol, x_symbol) * deriv(qx, x_symbol, x_symbol)
    quadratic += deriv(px, y_symbol, y_symbol) * deriv(qx, y_symbol, y_symbol)
    return sp.simplify((cubic + quadratic) / 16)


def _focus_normal_form(origin: sp.Matrix, _names: list[str], l1: sp.Expr) -> dict[str, Any]:
    return {
        "matchCoords": [_to_float(coord) for coord in origin],
        "kind": "Wc",
        "taylorSeriesLatex": r"W^{c}=\mathbb{R}^{2}",
        "reducedDynamicsLatex": rf"\dot{{r}}={_unit_coefficient(l1)}r^{{3}}+O(r^{{5}})",
    }


def _manifolds(
    f: sp.Matrix,
    variables: list[sp.Symbol],
    names: list[str],
    origin: sp.Matrix,
    modes: list[dict[str, Any]],
    l1: sp.Expr | None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    jets: list[dict[str, Any]] = []
    reduction = None
    real_curve_modes = [mode for mode in modes if is_zero(mode["im"]) and len(mode["vectors"]) == 1]
    full = sum(len(mode["vectors"]) for mode in modes) == len(variables)
    hyperbolic = all(abs(_to_float(mode["re"])) > 1e-8 for mode in modes)
    signs = {_kind(mode["re"]) for mode in modes}
    saddle = hyperbolic and "Es" in signs and "Eu" in signs
    if full and (saddle or not hyperbolic):
        for mode in real_curve_modes:
            kind = {"Es": "Ws", "Eu": "Wu", "Ec": "Wc"}[_kind(mode["re"])]
            if hyperbolic and kind == "Wc":
                continue
            degree = 5 if kind == "Wc" else 4
            jet = _curve_jet(f, variables, names, origin, mode, modes, kind, degree)
            if jet is None:
                continue
            jets.append(jet["series"])
            if jet.get("reduction"):
                reduction = jet["reduction"]
    if l1 is not None and not is_zero(l1) and not any(item["kind"] == "Wc" for item in jets):
        jets.append(_focus_normal_form(origin, names, l1))
    return jets, reduction


def _curve_jet(
    f: sp.Matrix,
    variables: list[sp.Symbol],
    names: list[str],
    origin: sp.Matrix,
    tangent_mode: dict[str, Any],
    modes: list[dict[str, Any]],
    kind: str,
    degree: int,
) -> dict[str, Any] | None:
    tangent = tangent_mode["vectors"][0]
    complement_vectors = [vector for mode in modes for vector in mode["vectors"] if vector is not tangent]
    if len(complement_vectors) != len(variables) - 1:
        return None
    basis = tangent
    for vector in complement_vectors:
        basis = basis.row_join(vector)
    if is_zero(basis.det()):
        return None
    u = sp.symbols("u")
    raw_symbols = sp.symbols(f"v0:{len(complement_vectors)}")
    if len(complement_vectors) == 1:
        v_symbols = (raw_symbols[0] if isinstance(raw_symbols, tuple) else raw_symbols,)
    else:
        v_symbols = tuple(raw_symbols)
    coordinates = sp.Matrix(len(variables), 1, [u, *v_symbols])
    shifted = origin + basis * coordinates
    transformed = sp.simplify(basis.inv() * f.subs(dict(zip(variables, shifted))))
    normal = sp.Matrix([transformed[index] for index in range(1, transformed.rows)])
    coefficients = _solve_curve_coefficients(transformed[0], normal, v_symbols, u, degree)
    if coefficients is None:
        return None
    components = []
    for index in range(len(v_symbols)):
        component = sum(coefficients[index].get(power, 0) * u**power for power in range(2, degree + 1))
        components.append(sp.expand(component))
    substitution = {symbol: component for symbol, component in zip(v_symbols, components)}
    residual_terms = []
    for index, component in enumerate(components):
        residual = sp.diff(component, u) * transformed[0].subs(substitution) - transformed[index + 1].subs(substitution)
        residual_terms.append(sp.simplify(sp.expand(residual)))
    exact = all(is_zero(term) for term in residual_terms)
    deviations = sp.simplify(basis * sp.Matrix([u, *components]))
    series_text = _format_curve(deviations, names, origin, u, degree, exact, kind)
    if series_text is None:
        return None
    result: dict[str, Any] = {
        "series": {
            "matchCoords": [_to_float(coord) for coord in origin],
            "kind": kind,
            "taylorSeriesLatex": series_text,
        }
    }
    if kind == "Wc":
        udot = sp.series(transformed[0].subs(substitution), u, 0, degree + 1).removeO()
        reduced, stability, classification, reason = _reduced_dynamics(udot, u, degree, exact, modes)
        result["series"]["reducedDynamicsLatex"] = reduced
        result["reduction"] = {"stability": stability, "classification": classification, "reason": reason}
    return result


def _solve_curve_coefficients(
    g_tangent: sp.Expr,
    g_normal: sp.Matrix,
    v_symbols: tuple[sp.Symbol, ...] | list[sp.Symbol],
    u: sp.Symbol,
    degree: int,
) -> list[dict[int, sp.Expr]] | None:
    known: list[dict[int, sp.Expr]] = [{} for _ in v_symbols]
    for order in range(2, degree + 1):
        unknowns = []
        graphs = []
        for index, _symbol in enumerate(v_symbols):
            unknown = sp.symbols(f"c_{index}_{order}")
            unknowns.append(unknown)
            graphs.append(sum(known[index].get(power, 0) * u**power for power in range(2, order)) + unknown * u**order)
        substitution = {symbol: graph for symbol, graph in zip(v_symbols, graphs)}
        equations = []
        for index in range(len(v_symbols)):
            residual = sp.diff(graphs[index], u) * g_tangent.subs(substitution) - g_normal[index].subs(substitution)
            try:
                coefficient = sp.series(residual, u, 0, order + 1).removeO()
            except Exception:
                coefficient = sp.expand(residual)
            equations.append(sp.expand(coefficient).coeff(u, order))
        solved = sp.solve(equations, unknowns, dict=True)
        if not solved:
            return None if order == 2 else known
        solution = solved[0]
        for index, unknown in enumerate(unknowns):
            known[index][order] = sp.simplify(solution.get(unknown, 0))
    return known


def _format_curve(
    displacement: sp.Matrix,
    names: list[str],
    origin: sp.Matrix,
    u: sp.Symbol,
    degree: int,
    exact: bool,
    kind: str,
) -> str | None:
    deviations = [sp.expand(displacement[index]) for index in range(displacement.rows)]
    linear = [sp.expand(deviation).coeff(u, 1) for deviation in deviations]
    magnitudes = []
    for coeff in linear:
        try:
            magnitudes.append(abs(_to_float(coeff)) if not is_zero(coeff) else 0.0)
        except Exception:
            magnitudes.append(0.0)
    if max(magnitudes, default=0.0) < 1e-10:
        return None
    independent = max(range(len(magnitudes)), key=lambda index: magnitudes[index])
    xi = sp.symbols("xi")
    reverted = _revert(deviations[independent], u, xi, degree)
    if reverted is None:
        return None
    atom = _coord_shift(names[independent], origin[independent])
    relations: list[str] = []
    for index, deviation in enumerate(deviations):
        if index == independent:
            continue
        composed = sp.expand(deviation.subs(u, reverted))
        truncated = sum(sp.expand(composed).coeff(xi, power) * xi**power for power in range(0, degree + 1))
        truncated = sp.simplify(sp.expand(truncated))
        target = names[index]
        star = origin[index]
        if is_zero(truncated):
            relation = f"{target}={lx(star)}" if exact else f"{target}={lx(star)}+O({atom}^{{{degree + 1}}})"
        else:
            body = _poly_latex(truncated, xi, atom)
            relation = f"{target}={body}" if is_zero(star) else f"{_coord_shift(target, star)}={body}"
            if not exact:
                relation += f"+O({atom}^{{{degree + 1}}})"
        relations.append(relation)
    if not relations:
        return None
    letter = {"Ws": "s", "Wu": "u", "Wc": "c"}[kind]
    return "W^{" + letter + "}: " + ", ".join(relations)


def _revert(series_expr: sp.Expr, u: sp.Symbol, xi: sp.Symbol, order: int) -> sp.Expr | None:
    expanded = sp.expand(series_expr)
    coeffs = [expanded.coeff(u, power) for power in range(0, order + 1)]
    if is_zero(coeffs[1]):
        return None
    betas = [sp.Integer(0), sp.simplify(1 / coeffs[1])]
    for power in range(2, order + 1):
        lower = sum(betas[index] * xi**index for index in range(1, power))
        composed = sp.expand(expanded.subs(u, lower))
        betas.append(sp.simplify(-composed.coeff(xi, power) / coeffs[1]))
    return sp.expand(sum(betas[index] * xi**index for index in range(1, order + 1)))


def _reduced_dynamics(
    udot: sp.Expr,
    u: sp.Symbol,
    degree: int,
    exact: bool,
    modes: list[dict[str, Any]],
) -> tuple[str, str, str | None, str]:
    expanded = sp.expand(udot)
    leading_power = None
    leading_coeff = sp.Integer(0)
    for power in range(2, degree + 1):
        coeff = sp.simplify(expanded.coeff(u, power))
        if not is_zero(coeff):
            leading_power = power
            leading_coeff = coeff
            break
    body = _poly_latex(expanded, u, "u")
    remainder = "" if exact else f"+O(u^{{{degree + 1}}})"
    hyperbolic_unstable = any(_to_float(mode["re"]) > 1e-8 for mode in modes)
    if leading_power is None:
        formula = rf"\dot{{u}}={body}{remainder}"
        return formula, "undetermined", None, "Every computed coefficient of the reduced center dynamics vanishes."
    if hyperbolic_unstable:
        formula = rf"\dot{{u}}={body}{remainder}"
        return formula, "unstable", None, "A hyperbolic eigenvalue has positive real part, so the equilibrium is unstable."
    if leading_power % 2 == 0:
        formula = rf"\dot{{u}}={body}{remainder}\implies \text{{semi-stable}}"
        return formula, "semi_stable", "saddle_node", rf"The reduced dynamics $\dot u = {body}$ has even leading order, a saddle-node."
    if _negative(leading_coeff):
        formula = rf"\dot{{u}}={body}{remainder}\implies \text{{asymptotically stable}}"
        return (
            formula,
            "asymptotically_stable",
            None,
            rf"On the center manifold $\dot{{u}}={body}{remainder}$, the first nonzero term has odd order and a negative coefficient.",
        )
    formula = rf"\dot{{u}}={body}{remainder}\implies \text{{unstable}}"
    return formula, "unstable", None, rf"On the center manifold $\dot{{u}}={body}{remainder}$, the first nonzero coefficient is positive."


def _state_is_angular(f: sp.Matrix, variables: list[sp.Symbol]) -> bool:
    return any(
        expr.has(sp.sin(var)) or expr.has(sp.cos(var)) or expr.has(sp.tan(var))
        for expr in f
        for var in variables
    )


def _coordinate_transforms(
    f: sp.Matrix,
    variables: list[sp.Symbol],
    names: list[str],
    analyzed: list[dict[str, Any]],
) -> dict[str, Any] | None:
    near_origin = [
        item
        for item in analyzed
        if item["coords"] and max(abs(value) for value in item["coords"]) < 1e-6
    ]
    origin_is_rotation = any(
        item["classification"] in {"stable_focus", "unstable_focus", "linear_center", "nonlinear_center", "weak_stable_focus", "weak_unstable_focus"}
        or any(abs(imag) > 1e-6 for imag in item["imagParts"])
        for item in near_origin
    )
    result: dict[str, Any] = {}
    if len(variables) == 2 and not _state_is_angular(f, variables):
        polar = _polar(f, variables, origin_is_rotation)
        if polar:
            result["polar2D"] = polar
    if len(variables) == 3:
        cylindrical = _cylindrical(f, variables, names)
        spherical = _spherical(f, variables)
        if cylindrical:
            result["cylindrical3D"] = cylindrical
        if spherical:
            result["spherical3D"] = spherical
    return result or None


def _planar_polar_components(
    f: sp.Matrix, variables: list[sp.Symbol], radius: sp.Symbol, angle: sp.Symbol
) -> tuple[sp.Expr, sp.Expr]:
    """r' = (x f1 + y f2)/r and θ' = (x f2 - y f1)/r^2, with cos^2 collapsed."""
    x, y = variables
    substitution = {x: radius * sp.cos(angle), y: radius * sp.sin(angle)}
    radial_num = sp.expand((x * f[0] + y * f[1]).subs(substitution))
    angular_num = sp.expand((x * f[1] - y * f[0]).subs(substitution))
    radial = _collapse_angle(sp.cancel(sp.together(radial_num / radius)), angle)
    angular = _collapse_angle(sp.cancel(sp.together(angular_num / radius**2)), angle)
    return radial, angular


def _polar(f: sp.Matrix, variables: list[sp.Symbol], origin_is_rotation: bool) -> dict[str, Any] | None:
    radius = sp.Dummy("r")
    angle = sp.Dummy("theta")
    x, y = variables
    radial, angular = _planar_polar_components(f, variables, radius, angle)
    rename = [(radius, "r"), (angle, "theta")]
    cart_ops = int(sp.count_ops(f[0]) + sp.count_ops(f[1]))
    polar_ops = int(sp.count_ops(radial) + sp.count_ops(angular))
    radial_decoupled = is_zero(sp.diff(radial, angle))
    reasons = []
    if radial_decoupled and is_zero(sp.diff(angular, angle)):
        reasons.append("Polynomial structure in r; radial and angular dynamics decouple.")
    elif radial_decoupled:
        reasons.append("Radial dynamics are independent of θ.")
    if polar_ops <= 0.85 * max(cart_ops, 1):
        reasons.append("Expression complexity drops in polar coordinates.")
    if _mentions_radius(f, x, y):
        reasons.append("The vector field contains x^2+y^2.")
    if origin_is_rotation:
        reasons.append("The origin is a focus, center, or weak focus.")
    if radial_decoupled:
        radii, stability = _radial_equilibria(radial, angular, radius, angle)
    else:
        radii, stability = [], []
    if any(radius_value > 1e-6 for radius_value in radii):
        reasons.append("A positive root of r' = 0 is a limit cycle when θ' ≠ 0.")
    return {
        "isRecommended": bool(reasons),
        **({"recommendationReason": " ".join(reasons)} if reasons else {}),
        "rDotLatex": _greek_latex(sp.latex(sp.simplify(radial.subs({radius: sp.Symbol("r"), angle: sp.Symbol("theta")})))),
        "thetaDotLatex": _greek_latex(sp.latex(sp.simplify(angular.subs({radius: sp.Symbol("r"), angle: sp.Symbol("theta")})))),
        "rDotExpr": _mathjs(radial, rename),
        "thetaDotExpr": _mathjs(angular, rename),
        "radialEquilibriaR": radii,
        "radialStability": stability,
    }


def _mentions_radius(f: sp.Matrix, x: sp.Symbol, y: sp.Symbol) -> bool:
    target = sp.expand(x**2 + y**2)
    for expr in f:
        if expr.has(x**2 + y**2):
            return True
        expanded = sp.expand(expr)
        if expanded.has(target) or (expanded.is_polynomial(x, y) and _polynomial_in_radius(expanded, x, y)):
            return True
    return False


def _polynomial_in_radius(expr: sp.Expr, x: sp.Symbol, y: sp.Symbol) -> bool:
    try:
        polynomial = sp.Poly(sp.expand(expr), x, y)
    except Exception:
        return False
    for (i, j), _coeff in polynomial.terms():
        if (i + j) % 2 == 1:
            return False
    rewritten = sp.expand(expr.subs(y**2, sp.symbols("s") - x**2))
    return not rewritten.has(x) or sp.degree(rewritten, x) <= 0


def _radial_equilibria(
    radial: sp.Expr, angular: sp.Expr, radius: sp.Symbol, angle: sp.Symbol
) -> tuple[list[float], list[str]]:
    if is_zero(radial):
        return [], []
    try:
        roots = sp.solve(sp.numer(sp.together(radial)), radius)
    except Exception:
        return [], []
    values: list[float] = []
    for root in roots:
        if getattr(root, "free_symbols", set()) - {angle}:
            if root.free_symbols:
                continue
        if root.free_symbols:
            continue
        try:
            value = _to_float(root)
        except Exception:
            continue
        if value >= -1e-8:
            values.append(0.0 if value < 1e-8 else value)
    unique = sorted({round(value, 8) for value in values})
    stability = [_radial_stability(radial, radius, value) for value in unique]
    if not is_zero(angular):
        return unique, stability
    return unique, ["unknown" for _ in unique]


def _radial_stability(radial: sp.Expr, radius: sp.Symbol, root: float) -> str:
    probe = sp.simplify(sp.diff(radial, radius).subs(radius, root))
    try:
        slope = _to_float(probe)
    except Exception:
        slope = 0.0
    if slope < -1e-8:
        return "attracting"
    if slope > 1e-8:
        return "repelling"
    left = _sample_radial(radial, radius, root - 0.2) if root > 0.2 else 0.0
    right = _sample_radial(radial, radius, root + 0.2)
    if root <= 1e-8:
        if right < -1e-8:
            return "attracting"
        if right > 1e-8:
            return "repelling"
        return "unknown"
    if left > 1e-8 and right < -1e-8:
        return "attracting"
    if left < -1e-8 and right > 1e-8:
        return "repelling"
    if (left > 1e-8 and right > 1e-8) or (left < -1e-8 and right < -1e-8):
        return "semi_stable"
    return "unknown"


def _sample_radial(radial: sp.Expr, radius: sp.Symbol, value: float) -> float:
    expr = sp.simplify(radial.subs(radius, value))
    try:
        return _to_float(expr)
    except Exception:
        if not expr.free_symbols:
            return 0.0
        sign = _proven_sign(expr, list(expr.free_symbols))
        if sign == "negative":
            return -1.0
        if sign == "positive":
            return 1.0
        try:
            return _to_float(expr.subs({symbol: 0 for symbol in expr.free_symbols}))
        except Exception:
            return 0.0


def _cylindrical(f: sp.Matrix, variables: list[sp.Symbol], names: list[str]) -> dict[str, Any] | None:
    radius = sp.Dummy("r")
    angle = sp.Dummy("theta")
    x, y, z = variables
    radial, angular = _planar_polar_components(f, [x, y], radius, angle)
    axial = _collapse_angle(sp.expand(f[2].subs({x: radius * sp.cos(angle), y: radius * sp.sin(angle)})), angle)
    decoupled = is_zero(sp.diff(radial, angle)) and is_zero(sp.diff(axial, angle))
    reasons = []
    if decoupled:
        reasons.append("Axisymmetric: r' and z' are independent of θ.")
    if _mentions_radius(f, x, y):
        reasons.append("The field contains x^2+y^2.")
    rename = [(radius, "r"), (angle, "theta")]
    return {
        "isRecommended": bool(reasons),
        **({"recommendationReason": " ".join(reasons)} if reasons else {}),
        "rDotLatex": _greek_latex(sp.latex(radial.subs({radius: sp.Symbol("r"), angle: sp.Symbol("theta")}))),
        "thetaDotLatex": _greek_latex(sp.latex(angular.subs({radius: sp.Symbol("r"), angle: sp.Symbol("theta")}))),
        "zDotLatex": _greek_latex(sp.latex(axial.subs({radius: sp.Symbol("r"), angle: sp.Symbol("theta")}))),
        "rDotExpr": _mathjs(radial, rename),
        "thetaDotExpr": _mathjs(angular, rename),
        "zDotExpr": _mathjs(axial, rename),
    }


def _spherical(f: sp.Matrix, variables: list[sp.Symbol]) -> dict[str, Any] | None:
    rho = sp.Dummy("rho")
    theta = sp.Dummy("theta")
    phi = sp.Dummy("phi")
    x, y, z = variables
    substitution = {
        x: rho * sp.sin(phi) * sp.cos(theta),
        y: rho * sp.sin(phi) * sp.sin(theta),
        z: rho * sp.cos(phi),
    }
    fx, fy, fz = (component.subs(substitution) for component in f)
    rho_dot = _collapse_angle(
        sp.expand(sp.sin(phi) * sp.cos(theta) * fx + sp.sin(phi) * sp.sin(theta) * fy + sp.cos(phi) * fz),
        theta,
    )
    theta_dot = _collapse_angle(
        sp.cancel(sp.together(sp.expand(-sp.sin(theta) * fx + sp.cos(theta) * fy) / (rho * sp.sin(phi)))),
        theta,
    )
    phi_dot = _collapse_angle(
        sp.cancel(
            sp.together(sp.expand(sp.cos(phi) * sp.cos(theta) * fx + sp.cos(phi) * sp.sin(theta) * fy - sp.sin(phi) * fz) / rho)
        ),
        theta,
    )
    decoupled = is_zero(sp.diff(rho_dot, theta)) and is_zero(sp.diff(rho_dot, phi))
    reasons = []
    if decoupled:
        reasons.append("Radial dynamics are independent of the angular coordinates.")
    if any(expr.has(x**2 + y**2 + z**2) for expr in f):
        reasons.append("The field contains x^2+y^2+z^2.")
    rename = [(rho, "rho"), (theta, "theta"), (phi, "phi")]
    latex_subs = {rho: sp.Symbol("rho"), theta: sp.Symbol("theta"), phi: sp.Symbol("phi")}
    return {
        "isRecommended": bool(reasons),
        **({"recommendationReason": " ".join(reasons)} if reasons else {}),
        "rhoDotLatex": _greek_latex(sp.latex(sp.simplify(rho_dot.subs(latex_subs)))),
        "thetaDotLatex": _greek_latex(sp.latex(sp.simplify(theta_dot.subs(latex_subs)))),
        "phiDotLatex": _greek_latex(sp.latex(sp.simplify(phi_dot.subs(latex_subs)))),
        "rhoDotExpr": _mathjs(rho_dot, rename),
        "thetaDotExpr": _mathjs(theta_dot, rename),
        "phiDotExpr": _mathjs(phi_dot, rename),
    }


def _lyapunov(
    f: sp.Matrix,
    variables: list[sp.Symbol],
    names: list[str],
    analyzed: list[dict[str, Any]],
    user_expr: str,
    hamiltonian_expr: str | None,
    hamiltonian_latex: str | None,
    warnings: list[str],
) -> dict[str, Any] | None:
    if user_expr:
        local = {name: symbol for name, symbol in zip(names, variables)}
        local.update({"sin": sp.sin, "cos": sp.cos, "exp": sp.exp, "sqrt": sp.sqrt, "pi": sp.pi, "e": sp.E})
        candidate = sp.sympify(_clean_rhs(user_expr), locals=local)
        return _lyapunov_record("user", candidate, f, variables, "Supplied by the user.")
    if hamiltonian_expr and hamiltonian_latex:
        candidate = sp.sympify(hamiltonian_expr.replace("^", "**"), locals={name: symbol for name, symbol in zip(names, variables)})
        record = _lyapunov_record("auto_hamiltonian", candidate, f, variables, "H is a first integral of the Hamiltonian system.")
        if record:
            record["vLatex"] = hamiltonian_latex
            return record
    mechanical = _mechanical_energy(f, variables)
    if mechanical is not None:
        return _lyapunov_record("auto_mechanical", mechanical, f, variables, "Mechanical energy of a second-order equation.")
    hurwitz = next((item for item in analyzed if item["realParts"] and all(part < -1e-8 for part in item["realParts"])), None)
    if hurwitz is None:
        return None
    origin = sp.Matrix(hurwitz["coords"])
    jacobian = sp.simplify(f.jacobian(variables).subs(dict(zip(variables, origin))))
    gram = _solve_lyapunov(jacobian)
    if gram is None:
        return None
    displacement = sp.Matrix(variables) - origin
    candidate = sp.simplify((displacement.T * gram * displacement)[0])
    return _lyapunov_record("auto_quadratic", candidate, f, variables, "Quadratic form solving J^T P + P J = -I at a Hurwitz equilibrium.")


def _lyapunov_record(source: str, candidate: sp.Expr, f: sp.Matrix, variables: list[sp.Symbol], note: str) -> dict[str, Any] | None:
    derivative = sp.simplify(sum(sp.diff(candidate, symbol) * f[index] for index, symbol in enumerate(variables)))
    classification = _classify_vdot(derivative, variables)
    conclusions = {
        "strict_lyapunov": rf"{note} $\dot V$ is negative definite, so the equilibrium is asymptotically stable.",
        "weak_lyapunov_lasalle": rf"{note} $\dot V\le 0$, so LaSalle's principle applies.",
        "conserved_first_integral": rf"{note} $\dot V\equiv 0$.",
        "indefinite": rf"{note} $\dot V$ changes sign.",
    }
    return {
        "source": source,
        "vLatex": lx(candidate),
        "vDotLatex": lx(derivative),
        "vExpr": _mathjs(candidate),
        "vDotExpr": _mathjs(derivative),
        "classification": classification,
        "conclusionLatex": conclusions[classification],
    }


def _classify_vdot(derivative: sp.Expr, variables: list[sp.Symbol]) -> str:
    if is_zero(derivative):
        return "conserved_first_integral"
    sign = _proven_sign(derivative, variables)
    if sign == "negative" and _pure_power_separates(derivative, variables):
        return "strict_lyapunov"
    if sign == "negative":
        return "weak_lyapunov_lasalle"
    sampled = _sample_sign(derivative, variables)
    if sampled == "negative":
        return "weak_lyapunov_lasalle"
    return "indefinite"


def _pure_power_separates(expr: sp.Expr, variables: list[sp.Symbol]) -> bool:
    if not expr.is_polynomial(*variables):
        return False
    polynomial = sp.Poly(sp.expand(expr), *variables)
    seen: set[int] = set()
    for exponents, coeff in polynomial.terms():
        if coeff == 0:
            continue
        support = [index for index, power in enumerate(exponents) if power]
        if len(support) == 1:
            seen.add(support[0])
    return len(seen) == len(variables)


def _proven_sign(expr: sp.Expr, variables: list[sp.Symbol]) -> str | None:
    try:
        simplified = sp.expand(expr)
        if is_zero(simplified):
            return "zero"
        if not simplified.free_symbols:
            number = _to_float(simplified)
            if number > 0:
                return "positive"
            if number < 0:
                return "negative"
            return "zero"
        monomial = _even_monomial_sign(simplified, variables)
        if monomial:
            return monomial
        if len(simplified.free_symbols) == 1:
            return _univariate_sign(simplified, next(iter(simplified.free_symbols)))
    except Exception:
        return None
    return None


def _only_zero_at_origin(expr: sp.Expr, variables: list[sp.Symbol]) -> bool:
    try:
        solutions = sp.solve(expr, variables, dict=True)
    except Exception:
        return False
    for solution in solutions:
        for var in variables:
            value = solution.get(var, 0)
            try:
                if abs(_to_float(value)) > 1e-7:
                    return False
            except Exception:
                return False
    return True


def _expression_sign(expr: sp.Expr, variables: list[sp.Symbol]) -> str | None:
    simplified = sp.expand(expr)
    if is_zero(simplified):
        return "zero"
    if not simplified.free_symbols:
        number = _to_float(simplified)
        if number > 0:
            return "positive"
        if number < 0:
            return "negative"
        return "zero"
    monomial = _even_monomial_sign(simplified, variables)
    if monomial:
        return monomial
    if len(variables) == 1 or (simplified.free_symbols and len(simplified.free_symbols) == 1):
        symbol = next(iter(simplified.free_symbols))
        univariate = _univariate_sign(simplified, symbol)
        if univariate:
            return univariate
    samples = _sample_sign(simplified, variables)
    return samples


def _even_monomial_sign(expr: sp.Expr, variables: list[sp.Symbol]) -> str | None:
    if not expr.is_polynomial(*variables):
        return None
    polynomial = sp.Poly(sp.expand(expr), *variables)
    if polynomial == 0:
        return "zero"
    sign = None
    for exponents, coeff in polynomial.terms():
        if coeff == 0:
            continue
        if any(power % 2 for power in exponents):
            return None
        current = "positive" if coeff > 0 else "negative"
        if sign is None:
            sign = current
        elif sign != current:
            return None
    return sign


def _univariate_sign(expr: sp.Expr, symbol: sp.Symbol) -> str | None:
    polynomial = sp.Poly(sp.expand(expr), symbol)
    if polynomial.degree() % 2 == 1:
        return None
    leading = polynomial.LC()
    critical = sp.solve(sp.diff(expr, symbol), symbol)
    values = []
    for root in critical:
        if root.free_symbols or not _is_real_expr(root):
            continue
        values.append(sp.simplify(expr.subs(symbol, root)))
    if leading > 0 and all(value >= 0 for value in values):
        return "positive"
    if leading < 0 and all(value <= 0 for value in values):
        return "negative"
    return None


def _sample_sign(expr: sp.Expr, variables: list[sp.Symbol]) -> str | None:
    grid = [0, 1, -1, 2, sp.Rational(1, 2), sp.Rational(-1, 2)]
    signs: set[int] = set()
    for point in product(grid, repeat=len(variables)):
        if all(coord == 0 for coord in point):
            continue
        value = expr.subs(dict(zip(variables, point)))
        if value.free_symbols:
            return None
        try:
            number = _to_float(value)
        except Exception:
            return None
        if number > 1e-7:
            signs.add(1)
        elif number < -1e-7:
            signs.add(-1)
    if signs == {1}:
        return "positive"
    if signs == {-1}:
        return "negative"
    return None


def _mechanical_energy(f: sp.Matrix, variables: list[sp.Symbol]) -> sp.Expr | None:
    if len(variables) != 2 or not is_zero(f[0] - variables[1]):
        return None
    position, _velocity = variables
    force = sp.simplify(f[1].subs(variables[1], 0))
    potential = -sp.integrate(force, position)
    if potential.has(sp.Integral):
        return None
    return sp.simplify(variables[1] ** 2 / 2 + potential)


def _solve_lyapunov(jacobian: sp.Matrix) -> sp.Matrix | None:
    size = jacobian.rows
    if size > 3:
        return None
    unknowns = []
    gram = sp.zeros(size)
    for row in range(size):
        for column in range(row, size):
            symbol = sp.symbols(f"P_{row}{column}")
            unknowns.append(symbol)
            gram[row, column] = symbol
            gram[column, row] = symbol
    residual = sp.simplify(jacobian.T * gram + gram * jacobian + sp.eye(size))
    equations = [residual[row, column] for row in range(size) for column in range(row, size)]
    try:
        solution = sp.solve(equations, unknowns, dict=True)
    except Exception:
        return None
    if not solution:
        return None
    return sp.simplify(gram.subs(solution[0]))


def _bendixson(f: sp.Matrix, x: sp.Symbol, y: sp.Symbol) -> dict[str, Any] | None:
    divergence = sp.expand(sp.diff(f[0], x) + sp.diff(f[1], y))
    candidates: list[tuple[sp.Expr, str, sp.Expr]] = [(divergence, "B(x,y)=1", sp.Integer(1))]
    for alpha in range(-2, 3):
        for beta in range(-2, 3):
            if alpha == 0 and beta == 0:
                continue
            combo = sp.expand(divergence + alpha * f[0] + beta * f[1])
            label = rf"B(x,y)=e^{{{lx(alpha * x + beta * y)}}}"
            candidates.append((combo, label, sp.exp(alpha * x + beta * y)))
    for combo, label, multiplier in candidates:
        sign = _proven_sign(combo, [x, y])
        if sign not in {"positive", "negative"}:
            continue
        product = sp.simplify(multiplier * combo)
        return {
            "applies": True,
            "multiplierLatex": label,
            "divergenceProductLatex": lx(product),
            "conclusion": "No periodic orbits exist in R^2",
        }
    return None
