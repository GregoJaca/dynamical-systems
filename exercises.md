Heat and Diffussion exercises:

\begin{enumerate}
  % From the Evans .tex file (extra problems)
  \item Let \(u(x,t)\) solve the heat equation
        \begin{gather*}
          u_t - \Delta u = 0 \qquad \text{in } \R^n \times (0, \infty) \,, \\
          u = g \qquad \text{on } \R^n \times \{ t=0 \}
        \end{gather*}
        with \(g \in C(\R^n) \cap L^1(\R^n)\). Show that
        \[ \| u \|_{L^\infty} \to 0 \qquad \text{as } t \to \infty \]
        while
        \[ \int_{\R^n} u(x,t) \, d x = \text{const} \,. \]
        Give a physical interpretation of each of the statements.

  \item Find a solution formula for the heat equation with advection,
        \begin{gather*}
          u_t - \Delta u + b \cdot D u = 0 \qquad \text{in } \R^n \times (0, \infty) \,, \\
          u = g \qquad \text{on } \R^n \times \{ t=0 \} \,.
        \end{gather*}
        Hint: which equation is solved by \(v(x,t)=u(x+bt,t)\)?

  % From MathMods sheet 4 (Salsa-level, six additional problems)
  \item Solve the heat equation in \(\mathbb{R}^{d}\) with convection:
        \[
          u_{t} - \Delta u + c\cdot \nabla u = 0,
        \]
        where \(x\in\mathbb{R}^{d}\), \(t>0\), \(c=(c_{1},\ldots,c_{d})^{\top}\neq 0\) is a constant vector, and \(u(x,0)=g(x)\).
        Hint: find a change of variables that reduces it to the heat equation.

  \item Suppose \(u\in C^{2}(\mathbb{R}^{d}\times(0,\infty))\) solves
        \[
          u_{t} - \Delta u = 0.
        \]
        (a) Show that \(u_{\lambda}(x,t)=u(\lambda x,\lambda^{2}t)\) is also a solution for every \(\lambda\in\mathbb{R}\).\\
        (b) Use (a) to prove that
            \[
              v(x,y)=x\cdot\nabla u+2t\,u_{t}
            \]
            is also a solution.

  \item Let
        \[
          u_{t}-u_{xx}=0,\quad x\in\mathbb{R},\ t>0,\qquad u(x,0)=g(x).
        \]
        Show that the solution is
        \[
          u(x,t)=\frac12\!\left(1+\phi\!\left(\frac{x}{\sqrt{4t}}\right)\right),
        \]
        where \(\phi(s)=\frac{2}{\sqrt{\pi}}\int_{0}^{s}e^{-r^{2}}dr\) is the error function.

  \item Solve the one-dimensional heat equation
        \[
          u_{t}-u_{xx}=0,\quad x>0,\ t>0,
        \]
        with bounded initial data \(g(x)\) satisfying \(g(0)=0\), and boundary condition \(u(0,t)=0\) for all \(t>0\).
        Hint: extend \(g\) oddly to the whole line and use the global Cauchy solution, being careful with the boundary condition.

  \item Assuming each \(u_{j}(y,t)\) (\(j=1,\ldots,d\), \(d\ge 2\)) solves the 1D heat equation \(u_{t}=u_{yy}\), show that
        \[
          v(x,t)=\prod_{j=1}^{d}u_{j}(x_{j},t)
        \]
        solves \(v_{t}-\Delta v=0\) in dimension \(d\).

  \item Let \(\epsilon>0\) and let \(u>0\) solve
        \[
          u_{t}-\epsilon u_{xx}=0,\quad x\in\mathbb{R},\ t>0.
        \]
        Prove that
        \[
          v(x,t)=-\frac{2\epsilon u_{x}}{u}
        \]
        satisfies the viscous Burgers equation
        \[
          v_{t}+vv_{x}=\epsilon v_{xx}.
        \]

  % From Evans Chapter 2, Problems 11, 12, 14 (explicit statements)
  \item (Evans, Ch.~2, Problem~11) Assume \(n=1\) and \(u=v(x^{2}/t)\).
        \begin{enumerate}
          \item Show that \(u_{t}=u_{xx}\) if and only if
                \[
                  4zv''(z)+(2+z)v'(z)=0,\quad z>0.
                \]
          \item Show that the general solution is
                \[
                  v(z)=c\int_{0}^{z}e^{-s/4}s^{-1/2}\,ds+d.
                \]
          \item Differentiate \(v(x^{2}/t)\) with respect to \(x\) and choose \(c\) to obtain the fundamental solution \(\Phi\) for \(n=1\).
        \end{enumerate}

  \item (Evans, Ch.~2, Problem~12) Find an explicit solution (in terms of \(\Phi\)) of
        \[
          \begin{cases}
            u_{t}-\Delta u+cu=f & \text{on }\mathbb{R}^{n}\times(0,\infty),\\
            u=g & \text{on }\mathbb{R}^{n}\times\{t=0\},
          \end{cases}
        \]
        where \(f\in C(\mathbb{R}^{n}\times(0,\infty))\) and \(g\in C(\mathbb{R}^{n})\cap L^{\infty}(\mathbb{R}^{n})\).

  \item (From Evans Ch.~2, Problem~14) Let \(U=(0,1)\) and let \(u\) solve
        \[
          \begin{cases}
            u_{t}-u_{xx}=0 & \text{in }(0,1)\times(0,\infty),\\
            u(x,0)=x(1-x) & \text{for }x\in[0,1],\\
            u(0,t)=u(1,t)=0 & \text{for }t>0.
          \end{cases}
        \]
        Show that \(u\ge 0\), and that there exist constants \(\alpha,\beta>0\) such that
        \[
          u(x,t)\le \alpha x(1-x)e^{-\beta t}.
        \]
        Deduce that \(u(x,t)\to0\) as \(t\to\infty\).
\end{enumerate}


2. Characteristics: linear and quasilinear exercises


\begin{enumerate}
  % Evans §3.5 problems (as referenced)
  \item (Evans, Problem 3.5.4) Solve by the method of characteristics.

  \item (Evans, Problem 3.5.5 (a) and (c)) Solve by characteristics. Note that the solutions may not be global; for part (c) solve on the domain \(U = \{x \in \mathbb{R}^2 \mid x_2 \neq 2\}\).

  \item (Evans, Problem 3.5.6 for \(n=2\)) In part (b), show that \(\partial_s(v(X(s,x,t),s)J(s,x,t)) = 0\) provided \(v(x,t)\) is a solution of the PDE stated.\\
        Hint: writing \(X(s,x,t) = (X^1,X^2)\), use the ODE \(X_s(s,x,t) = b(X(s,x,t)) = (b^1 (X),b^2 (X))\) and the chain rule to show that
        \[
          X_{s x_i}^1 = b_{x_1}^1 (X)X_{x_i}^1 + b_{x_2}^1 (X)X_{x_i}^2,
        \]
        and similarly for \(X_{s x_i}^2\).

  % ETH sheet (linear and quasilinear)
  \item Solve using the method of characteristics:
        \begin{enumerate}
          \item \(x u_{x}+u_{y}=1\), with \(u(x,0)=f(x)\).
          \item \((1+x^{2})u_{x}+(y\arctan x)u_{y}=u\), with \(u(0,2y)=y-9\).
          \item \(u u_{x}+\cos(x)u_{y}=0\), with \(u(x,\sin x/x)=x\) for \(y\neq0\).
          \item \(y u_{x}+x u_{y}=0\), with \(u(x,0)=g(x^{2})\) for \(x>0\).
        \end{enumerate}

  \item Consider the PDE
        \[
          u_{x}-u_{y}=xy.
        \]
        Solve the associated characteristic ODE system. Then, for each of the following data, find an explicit solution by characteristics if possible; if not, explain why.
        \begin{enumerate}
          \item \(u(x,x)=3\), \(x\in\mathbb{R}\).
          \item \(u(x,-x)=3\), \(x\in\mathbb{R}\).
        \end{enumerate}

  % Midterm-style linear problems
  \item Solve the first-order linear PDE
        \[
          -\frac{\partial u}{\partial x}+2\frac{\partial u}{\partial y}+xu=0,
        \]
        and impose the initial condition \(u(x,0)=2x e^{x^{2}/2}\).

  \item Solve the transport equation
        \[
          2x\frac{\partial u}{\partial x}+\frac{\partial u}{\partial y}=0
        \]
        by the method of characteristics, and discuss the domain of definition of the solution depending on the initial curve.

  % MathMods sheet 1 (linear and quasilinear, eight problems)
  \item Solve
        \[
          \rho_{t}-c\rho_{x}=0,\quad x\le 0,\ t\ge 0,
        \]
        \[
          \rho(x,0)=0\quad(x\le 0),\qquad \rho(0,t)=g(t)\quad(t\ge 0),
        \]
        with \(c>0\) constant. Interpret in terms of traffic flow.

  \item Solve
        \[
          \rho_{t}+c\rho_{x}=0,\quad x\ge 0,\ t\ge 0,
        \]
        \[
          \rho(x,0)=0\quad(x\ge 0),\qquad \rho(\alpha t,t)=g(t)\quad(\alpha>0,\,t\ge 0),
        \]
        where \(c>0\) is constant. Write the explicit solution and give a geometric interpretation. What happens if \(\alpha=c\)? Interpret in terms of traffic flow.

  \item Study the characteristics and the solution to the linear equation
        \[
          y u_{x}-x u_{y}=1,\qquad (x,y)\in\mathbb{R}^{2},
        \]
        \[
          u(x,0)=0,\qquad x\in\mathbb{R}.
        \]
        Find the ODE system and study the map \((\eta,\xi)\mapsto(x,y)\). Where is it invertible? Is the solution continuous at \(x=0\)? If instead \(u(x,0)=f(x)\) and the solution is continuous at \(x=0\), what can you say about \(f(x)\) and \(f(0)\)?

  \item Solve the initial-value problem
        \[
          u_{t}+u u_{x}=1,
        \]
        \[
          u(x,0)=-\tfrac12 x.
        \]
        Find the characteristic curves (draw a picture) and give an explicit formula for the solution. Where does it exist? Does it exist for all \((x,t)\in\mathbb{R}\times[0,\infty)\)? Explain.

  \item Solve the linear equation
        \[
          x u_{y}-y u_{x}=u,
        \]
        under \(u(x,0)=f(x)\), where \(f\in C^{1}\). Where is the solution valid? Classify the functions \(f\) for which a \textbf{global} \(C^{1}\) solution exists.

  \item Solve the Cauchy problem
        \[
          u_{x}+u_{y}=u^{4},
        \]
        where \(u(x,0)=f(x)\), \(f\in C^{1}\). Discuss the invertibility of the mapping and the range of existence of a \(C^{1}\) solution.

  \item For the quasilinear Cauchy problem
        \[
          u_{y}=x u u_{x},
        \]
        with \(u(x,0)=x\), study the characteristics and discuss the invertibility of the mapping (this may not be possible explicitly). Write the solution implicitly.

  \item Determine the solution to
        \[
          u_{x}+(x+y)u_{y}=x y,
        \]
        with data \(u(x,0)=x\). Study the ODE system, the invertibility of the mapping, etc.
\end{enumerate}

characteristics: fully non-linear

\begin{enumerate}
  % MathMods sheet 2 (items 1–3; item 4 is a duplicate of the quasilinear problem above)
  \item Solve
        \[
          x u_{x}+y u_{y}+u_{x}u_{y}-u=0,
        \]
        with \(u(x,-x)=1\).

  \item For
        \[
          u_{y}=u_{x}^{3},
        \]
        find the solution for \(u(x,0)=2x^{3/2}\). (Answer: \(2x^{3/2}(1-27y)^{-1/2}\).)

  \item Find a solution to
        \[
          u=x u_{x}+y u_{y}+\tfrac12(u_{x}^{2}+u_{y}^{2}),
        \]
        with \(u(x,0)=\tfrac12(1-x^{2})\).
\end{enumerate}